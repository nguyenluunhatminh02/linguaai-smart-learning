// @ts-nocheck
/**
 * MfaController Unit Tests (SEC-04)
 *
 * The controller is a thin delegation layer; these tests pin the routing
 * contract so a refactor cannot silently drop a route or change the shape
 * of the response the web client relies on.
 *
 * MfaService imports otplib, which pulls in ESM-only dependencies Jest cannot
 * parse, so it is mocked at module level before the controller import.
 */

jest.mock('../services/mfa.service', () => ({
  MfaService: class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { MfaController } from './mfa.controller';
import { MfaService } from '../services/mfa.service';

const makeUser = (over: any = {}) => ({
  id: 'user-123',
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
  twoFactorEnabled: false,
  ...over,
});

const mockReq = () =>
  ({
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    get: jest.fn(),
  }) as any;

describe('MfaController', () => {
  let controller: MfaController;
  let mockMfaService: any;

  beforeEach(async () => {
    mockMfaService = {
      getMfaStatus: jest.fn().mockResolvedValue({ enabled: false }),
      setupMfa: jest.fn().mockResolvedValue({
        secret: 'SECRET',
        qrCodeUrl: 'data:image/png;base64,x',
        backupCodes: ['a', 'b'],
      }),
      verifyAndEnableMfa: jest
        .fn()
        .mockResolvedValue({ message: 'Two-factor authentication enabled' }),
      disableMfa: jest
        .fn()
        .mockResolvedValue({ message: 'Two-factor authentication disabled' }),
      regenerateBackupCodes: jest
        .fn()
        .mockResolvedValue({ backupCodes: ['c', 'd'] }),
      getBackupCodesCount: jest.fn().mockResolvedValue({ remaining: 2 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MfaController],
      providers: [{ provide: MfaService, useValue: mockMfaService }],
    }).compile();

    controller = module.get<MfaController>(MfaController);
  });

  it('getStatus forwards the user id and returns the service result', async () => {
    const result = await controller.getStatus('user-123');
    expect(mockMfaService.getMfaStatus).toHaveBeenCalledWith('user-123');
    expect(result).toEqual({ enabled: false });
  });

  it('setup forwards the full user object', async () => {
    const user = makeUser();
    const result = await controller.setup(user);
    expect(mockMfaService.setupMfa).toHaveBeenCalledWith(user);
    expect(result).toEqual(
      expect.objectContaining({
        secret: 'SECRET',
        qrCodeUrl: expect.any(String),
      }),
    );
  });

  it('confirmSetup unwraps the DTO and forwards the request', async () => {
    const user = makeUser();
    const req = mockReq();
    const result = await controller.confirmSetup({ code: '123456' }, user, req);
    expect(mockMfaService.verifyAndEnableMfa).toHaveBeenCalledWith(
      { code: '123456' },
      user,
      req,
    );
    expect(result.message).toMatch(/enabled/);
  });

  it('disable unwraps the DTO and forwards the request', async () => {
    const user = makeUser({ twoFactorEnabled: true });
    const req = mockReq();
    const result = await controller.disable({ code: '123456' }, user, req);
    expect(mockMfaService.disableMfa).toHaveBeenCalledWith(
      { code: '123456' },
      user,
      req,
    );
    expect(result.message).toMatch(/disabled/);
  });

  it('regenerateBackupCodes forwards the user id and TOTP code', async () => {
    const result = await controller.regenerateBackupCodes(
      { code: '123456' },
      'user-123',
    );
    expect(mockMfaService.regenerateBackupCodes).toHaveBeenCalledWith(
      'user-123',
      '123456',
    );
    expect(result.backupCodes).toEqual(['c', 'd']);
  });

  it('backupCodesCount forwards the user id', async () => {
    const result = await controller.backupCodesCount('user-123');
    expect(mockMfaService.getBackupCodesCount).toHaveBeenCalledWith('user-123');
    expect(result).toEqual({ remaining: 2 });
  });
});
