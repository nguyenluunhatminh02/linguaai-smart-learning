import { Test, TestingModule } from '@nestjs/testing';
import { FilesService } from './files.service';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');

describe('FilesService', () => {
  let service: FilesService;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'API_PORT') return '3001';
      if (key === 'API_URL') return 'http://localhost:3001';
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    // Mock existsSync to return true so mkdirSync is not called during init
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('uploadFile', () => {
    it('should save file locally and return API URL', async () => {
      const mockFile = {
        originalname: 'avatar.png',
        buffer: Buffer.from('fake image data'),
      } as Express.Multer.File;

      (fs.writeFileSync as jest.Mock).mockReturnValue(undefined);

      const url = await service.uploadFile(mockFile);

      expect(url).toContain('http://localhost:3001/uploads/');
      expect(url).toContain('.png');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        mockFile.buffer,
      );
    });

    it('should throw BadRequestException if writeFileSync fails', async () => {
      const mockFile = {
        originalname: 'avatar.png',
        buffer: Buffer.from('fake image data'),
      } as Express.Multer.File;

      (fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('Disk full');
      });

      await expect(service.uploadFile(mockFile)).rejects.toThrow();
    });
  });

  describe('generateTTS', () => {
    it('should return Google Translate TTS URL with standard query parameters', async () => {
      const text = 'Hello world';
      const language = 'English';

      const url = await service.generateTTS(text, language);

      expect(url).toContain('https://translate.google.com/translate_tts');
      expect(url).toContain('tl=en');
      expect(url).toContain('q=Hello%20world');
    });

    it('should correctly map Vietnamese language to vi code', async () => {
      const text = 'Xin chào';
      const language = 'Vietnamese';

      const url = await service.generateTTS(text, language);

      expect(url).toContain('tl=vi');
      expect(url).toContain('q=Xin%20ch%C3%A0o');
    });
  });
});
