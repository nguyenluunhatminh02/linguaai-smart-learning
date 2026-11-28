import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ForgotPasswordDto, MfaVerifyDto, ResetPasswordDto } from './auth.dto';
import { LoginDto } from './login.dto';

describe('auth DTO input limits', () => {
  it('rejects oversized login emails and passwords before bcrypt work', async () => {
    const dto = plainToInstance(LoginDto, {
      email: `${'a'.repeat(250)}@example.com`,
      password: 'P@ssw0rd123',
    });
    const properties = (await validate(dto)).map((e) => e.property);
    expect(properties).toContain('email');

    const longPassword = plainToInstance(LoginDto, {
      email: 'alice@example.com',
      password: 'x'.repeat(129),
    });
    expect((await validate(longPassword)).map((e) => e.property)).toContain(
      'password',
    );
  });

  it('accepts a valid login payload', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'alice@example.com',
      password: 'P@ssw0rd123',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects oversized email, reset token, and MFA identity fields', async () => {
    const forgot = plainToInstance(ForgotPasswordDto, {
      email: `${'a'.repeat(250)}@example.com`,
    });
    expect((await validate(forgot)).map((e) => e.property)).toContain('email');

    const reset = plainToInstance(ResetPasswordDto, {
      token: 't'.repeat(513),
      newPassword: 'NewP@ssw0rd!',
      confirmPassword: 'NewP@ssw0rd!',
    });
    expect((await validate(reset)).map((e) => e.property)).toContain('token');

    const mfa = plainToInstance(MfaVerifyDto, {
      mfaToken: 'j'.repeat(4097),
      totpCode: '123456',
      deviceId: 'd'.repeat(256),
      deviceName: 'n'.repeat(256),
      deviceType: 't'.repeat(51),
    });
    const properties = (await validate(mfa)).map((e) => e.property);
    expect(properties).toEqual(
      expect.arrayContaining([
        'mfaToken',
        'deviceId',
        'deviceName',
        'deviceType',
      ]),
    );
  });

  it('accepts boundary-valid auth payloads', async () => {
    const reset = plainToInstance(ResetPasswordDto, {
      token: 't'.repeat(512),
      newPassword: 'NewP@ssw0rd!',
      confirmPassword: 'NewP@ssw0rd!',
    });
    await expect(validate(reset)).resolves.toHaveLength(0);

    const mfa = plainToInstance(MfaVerifyDto, {
      mfaToken: 'j'.repeat(4096),
      totpCode: '123456',
      deviceId: 'd'.repeat(255),
      deviceName: 'n'.repeat(255),
      deviceType: 't'.repeat(50),
    });
    await expect(validate(mfa)).resolves.toHaveLength(0);
  });
});
