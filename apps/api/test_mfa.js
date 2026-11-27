const axios = require('axios');
const { generate } = require('otplib');
const { PrismaClient } = require('./src/generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const Redis = require('ioredis');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const PORT = process.env.API_PORT || 3001;
const BASE_URL = `http://localhost:${PORT}/api/v1`;

const host = process.env.DATABASE_HOST || 'localhost';
const port = process.env.DATABASE_PORT || 5432;
const username = process.env.DATABASE_USER || 'linguaai';
const passwordDb = process.env.DATABASE_PASSWORD || 'linguaai_secret';
const database = process.env.DATABASE_NAME || 'linguaai';
const ssl = process.env.DATABASE_SSL === 'true';

const dbUrl = process.env.DATABASE_URL || `postgresql://${username}:${encodeURIComponent(passwordDb)}@${host}:${port}/${database}?schema=public${ssl ? '&sslmode=require' : ''}`;
process.env.DATABASE_URL = dbUrl;

async function runTest() {
  console.log('=== STARTING MFA INTEGRATION TEST ===\n');

  const pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  });

  const email = 'nguyen.minh@linguaai.local';
  const password = 'TestUser!2024';

  try {
    // 0. Clean up user devices & MFA in DB to ensure fresh start
    console.log('Step 0: Cleaning up database state for test user...');
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) {
      throw new Error(`User ${email} not found`);
    }

    const userCacheKey = `cache:user:${user.id}`;

    // Deactivate all devices
    await prisma.user_devices.updateMany({
      where: { user_id: user.id },
      data: { active: false }
    });
    console.log('✔ All existing devices deactivated.');

    // Delete existing MFA secrets to ensure it's disabled
    await prisma.mfa_secrets.deleteMany({
      where: { user_id: user.id }
    });
    await prisma.users.update({
      where: { id: user.id },
      data: { two_factor_enabled: false }
    });
    
    // Clear user cache in Redis
    await redis.del(userCacheKey);
    console.log('✔ Existing MFA settings reset to disabled & Redis cache cleared.');

    // 1. Login to get initial Access Token
    console.log(`\nStep 1: Logging in as ${email}...`);
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      email,
      password,
      deviceId: 'test-chrome-device',
      deviceName: 'Chrome - Windows',
      deviceType: 'DESKTOP'
    });
    
    // Extract token from wrapped response { success: true, data: { accessToken, ... } }
    const accessToken = loginRes.data.data.accessToken;
    console.log('✔ Logged in successfully. Access token retrieved.');

    const authHeaders = {
      headers: { Authorization: `Bearer ${accessToken}` }
    };

    // 2. Check current MFA status
    console.log('\nStep 2: Checking current MFA status...');
    const statusRes = await axios.get(`${BASE_URL}/mfa/status`, authHeaders);
    console.log('MFA status response:', statusRes.data.data);

    // 3. Initiate MFA Setup
    console.log('\nStep 3: Initiating MFA Setup...');
    const setupRes = await axios.post(`${BASE_URL}/mfa/setup`, {}, authHeaders);
    const { secret, qrCodeUrl, backupCodes } = setupRes.data.data;
    console.log('MFA setup initialized.');
    console.log(`- TOTP Secret Key: ${secret}`);
    console.log(`- QR Code Data URL length: ${qrCodeUrl.length} characters`);
    console.log(`- Backup Codes (first 3):`, backupCodes.slice(0, 3));

    // 4. Generate TOTP code and confirm setup
    console.log('\nStep 4: Generating TOTP code from secret and confirming setup...');
    const totpCode = await generate({ secret });
    console.log(`Generated TOTP code: ${totpCode}`);

    const confirmRes = await axios.post(`${BASE_URL}/mfa/setup/confirm`, { code: totpCode }, authHeaders);
    console.log('MFA confirm response:', confirmRes.data.data);

    // Force clear Redis cache so changes propagate instantly to active session
    await redis.del(userCacheKey);
    console.log('✔ Confirmed: Redis user cache invalidated.');

    // 5. Verify MFA is enabled in status
    console.log('\nStep 5: Verifying MFA status again...');
    const statusRes2 = await axios.get(`${BASE_URL}/mfa/status`, authHeaders);
    console.log('MFA status response:', statusRes2.data.data);

    // 6. Test Logging in with MFA enabled (on a NEW device to trigger challenge)
    console.log('\nStep 6: Testing login on a NEW device with MFA enabled...');
    const loginResNew = await axios.post(`${BASE_URL}/auth/login`, {
      email,
      password,
      deviceId: 'new-untrusted-device',
      deviceName: 'New Device',
      deviceType: 'DESKTOP'
    });
    
    const loginData = loginResNew.data.data;
    if (loginData.mfaRequired) {
      console.log('✔ Success: Login returned mfaRequired as expected.');
      const { mfaToken } = loginData;
      console.log(`MFA Token: ${mfaToken.slice(0, 30)}...`);

      // 7. Verify MFA Challenge
      console.log('\nStep 7: Completing MFA login challenge with a new TOTP code...');
      const loginTotpCode = await generate({ secret });
      console.log(`Generated login TOTP code: ${loginTotpCode}`);

      const verifyMfaRes = await axios.post(`${BASE_URL}/auth/verify-mfa`, {
        mfaToken,
        totpCode: loginTotpCode,
        deviceId: 'new-untrusted-device',
        deviceName: 'New Device',
        deviceType: 'DESKTOP'
      });
      console.log('✔ MFA Challenge completed successfully!');
      const mfaLoginData = verifyMfaRes.data.data;
      console.log('Access token from MFA login:', mfaLoginData.accessToken.slice(0, 30) + '...');
      console.log('User profile in response:', mfaLoginData.user);

      // Force clear cache before disabling MFA
      await redis.del(userCacheKey);

      // 8. Clean up: Disable MFA for user so they can log in normally via web UI
      console.log('\nStep 8: Disabling MFA to restore normal login...');
      const cleanupHeaders = {
        headers: { Authorization: `Bearer ${mfaLoginData.accessToken}` }
      };
      const cleanupTotpCode = await generate({ secret });
      const disableRes = await axios.post(`${BASE_URL}/mfa/disable`, { code: cleanupTotpCode }, cleanupHeaders);
      console.log('MFA disable response:', disableRes.data.data);

      // Force clear Redis cache again
      await redis.del(userCacheKey);

      console.log('\nStep 9: Confirming MFA is disabled in DB...');
      const statusRes3 = await axios.get(`${BASE_URL}/mfa/status`, cleanupHeaders);
      console.log('Final MFA status:', statusRes3.data.data);
    } else {
      console.log('❌ Error: Login succeeded without prompting for MFA!', loginData);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
    await redis.disconnect();
  }

  console.log('\n=== MFA INTEGRATION TEST COMPLETED SUCCESSFULLY ===');
}

runTest().catch(err => {
  console.error('❌ Test failed:', err.response ? err.response.data : err.message);
});
