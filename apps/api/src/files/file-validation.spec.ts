import { BadRequestException } from '@nestjs/common';
import {
  MAX_UPLOAD_BYTES,
  decodeStrictBase64,
  extensionForMimeType,
  hasAudioSignature,
  normalizeMimeType,
  validateAudioPayload,
  validateUploadedFile,
} from './file-validation';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function multerFile(buffer: Buffer, mimetype: string, originalname = 'untrusted.html') {
  return { buffer, mimetype, originalname, size: buffer.length } as Express.Multer.File;
}

describe('file validation', () => {
  it('accepts a real PNG and derives the extension from MIME, not the filename', () => {
    const result = validateUploadedFile(multerFile(PNG, 'image/png; charset=binary', 'avatar.exe'));
    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
    expect(result.size).toBe(PNG.length);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a spoofed MIME type when the bytes do not match', () => {
    expect(() => validateUploadedFile(multerFile(Buffer.from('<script>alert(1)</script>'), 'image/png')))
      .toThrow(BadRequestException);
  });

  it('rejects disallowed MIME types and unknown MIME-derived extensions', () => {
    expect(() => validateUploadedFile(multerFile(PNG, 'text/html'))).toThrow(BadRequestException);
    expect(extensionForMimeType('application/x-shockwave-flash')).toBeNull();
    expect(normalizeMimeType(' Audio/WEBM;codecs=opus ')).toBe('audio/webm');
  });

  it('rejects oversized files before validation completes', () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]);
    expect(() => validateUploadedFile(multerFile(huge, 'image/png'))).toThrow(/exceeds limit/);
  });

  it('strictly decodes base64 and enforces the decoded-byte budget', () => {
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('webm'), Buffer.alloc(20, 1)]);
    const encoded = webm.toString('base64');
    expect(decodeStrictBase64(encoded)!.equals(webm)).toBe(true);
    expect(decodeStrictBase64('not base64!!')).toBeNull();
    expect(decodeStrictBase64(`${encoded}\n`)).toBeNull(); // non-canonical
    expect(decodeStrictBase64(Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString('base64'))).toBeNull();

    const decoded = validateAudioPayload(encoded, 'audio/webm;codecs=opus');
    expect(decoded.extension).toBe('webm');
  });

  it('rejects audio whose declared MIME does not match its signature', () => {
    expect(() => validateAudioPayload(Buffer.from(PNG).toString('base64'), 'audio/mpeg'))
      .toThrow(BadRequestException);
    expect(() => validateAudioPayload(Buffer.from('ID3').toString('base64'), 'image/png'))
      .toThrow(BadRequestException);
  });

  it('accepts EBML-signature WebM frames (including live WS chunks)', () => {
    const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    expect(hasAudioSignature(header, 'audio/webm')).toBe(true);
    expect(hasAudioSignature(Buffer.from('not-a-webm'), 'audio/webm')).toBe(false);
  });
});
