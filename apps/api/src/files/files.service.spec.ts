import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { FilesService } from './files.service';
import { ConfigService } from '@nestjs/config';
import { StorageAdapter } from './file-validation';

/**
 * SEC-02 / SEC-08 regression: object names must be server-generated from the
 * authenticated owner id, never from the client-supplied filename; ownership
 * must be enforced on read/delete; generateTTS stays a shared public URL.
 */
describe('FilesService ownership (SEC-02/SEC-08)', () => {
  let service: FilesService;
  let storage: any;
  const OWNER_ID = '00000000-0000-4000-8000-000000000001';
  const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'API_PORT') return '3001';
      if (key === 'API_URL') return 'http://localhost:3001';
      return defaultValue;
    }),
  };

  const pngFile = (name = 'avatar.png'): Express.Multer.File =>
    ({
      originalname: name,
      mimetype: 'image/png',
      size: 8,
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    }) as Express.Multer.File;

  beforeEach(async () => {
    storage = {
      generateKey: jest.fn(
        (userId: string, ext: string) => `${userId}/test-uuid.${ext}`,
      ),
      put: jest.fn().mockResolvedValue(undefined),
      urlForKey: jest.fn(
        (key: string, base: string) => `${base}/uploads/${key}`,
      ),
      assertOwner: jest.fn((key: string, userId: string) => {
        if (!key.startsWith(`${userId}/`))
          throw new BadRequestException('File not found or access denied');
        return key;
      }),
      head: jest.fn().mockResolvedValue({ key: 'k', size: 8 }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: StorageAdapter, useValue: storage },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('uploadFile', () => {
    it('server-generates an owner-scoped key from the authenticated user id', async () => {
      const url = await service.uploadFile(
        pngFile('../../../../etc/passwd'),
        OWNER_ID,
      );

      expect(storage.generateKey).toHaveBeenCalledWith(OWNER_ID, 'png');
      expect(url).toContain(`http://localhost:3001/uploads/${OWNER_ID}/`);
      expect(url).not.toContain('passwd');
      expect(storage.put).toHaveBeenCalled();
    });

    it('rejects an unauthenticated upload before storing any bytes', async () => {
      await expect(
        service.uploadFile(pngFile(), undefined as any),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('rejects an attacker-supplied owner id with invalid characters', async () => {
      await expect(service.uploadFile(pngFile(), '../admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('returns a failure when storage.put fails', async () => {
      storage.put.mockRejectedValue(new Error('Disk full'));
      await expect(service.uploadFile(pngFile(), OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('ownership on stored objects', () => {
    const key = `${OWNER_ID}/test-uuid.png`;

    it('lets the owner head and delete their own file', async () => {
      await expect(service.headFile(key, OWNER_ID)).resolves.toEqual({
        key: 'k',
        size: 8,
      });
      await expect(service.deleteFile(key, OWNER_ID)).resolves.toBeUndefined();
      expect(storage.delete).toHaveBeenCalledWith(key);
    });

    it('denies a different user access to the same object key', async () => {
      await expect(service.headFile(key, OTHER_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.deleteFile(key, OTHER_USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('generateTTS', () => {
    it('returns the shared public Google Translate TTS URL with standard parameters', async () => {
      const url = await service.generateTTS('Hello world', 'English');
      expect(url).toContain('https://translate.google.com/translate_tts');
      expect(url).toContain('tl=en');
      expect(url).toContain('q=Hello%20world');
    });

    it('maps Vietnamese to vi and does not include any owner state', async () => {
      const url = await service.generateTTS('Xin chào', 'Vietnamese');
      expect(url).toContain('tl=vi');
      expect(url).toContain('q=Xin%20ch%C3%A0o');
      expect(url).not.toContain(OWNER_ID);
    });
  });
});
