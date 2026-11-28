import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

describe('FilesController', () => {
  let controller: FilesController;
  const uploadFile = jest.fn().mockResolvedValue('http://localhost:3001/uploads/user-1/a.png');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: FilesService, useValue: { uploadFile, generateTTS: jest.fn() } },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true }).compile();
    controller = module.get(FilesController);
    jest.clearAllMocks();
  });

  it('passes the authenticated user id to the service and keeps the { url } contract', async () => {
    const file = { mimetype: 'image/png', size: 10, buffer: Buffer.from('x') } as Express.Multer.File;
    await expect(controller.uploadFile('user-1', file)).resolves.toEqual({
      url: 'http://localhost:3001/uploads/user-1/a.png',
    });
    expect(uploadFile).toHaveBeenCalledWith(file, 'user-1');
  });

  it('rejects a missing file', async () => {
    await expect(controller.uploadFile('user-1', undefined as any)).rejects.toThrow(BadRequestException);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects oversized buffered files in the controller as defence in depth', async () => {
    const file = { mimetype: 'image/png', size: 11 * 1024 * 1024, buffer: Buffer.from('x') } as Express.Multer.File;
    await expect(controller.uploadFile('user-1', file)).rejects.toThrow(BadRequestException);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
