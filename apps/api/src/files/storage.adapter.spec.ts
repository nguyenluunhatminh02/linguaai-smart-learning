import { BadRequestException } from '@nestjs/common';
import { StorageAdapter } from './file-validation';

describe('StorageAdapter ownership checks', () => {
  const adapter = new StorageAdapter();

  it('generates owner-scoped server keys and ignores client filenames', () => {
    const key = adapter.generateKey('user-123', 'png');
    expect(key).toMatch(/^user-123\/[0-9a-f-]{36}\.png$/);
    expect(adapter.assertOwner(key, 'user-123')).toBe(key);
  });

  it('rejects another user\'s key, nested keys and traversal', () => {
    const key = adapter.generateKey('user-123', 'webm');
    expect(() => adapter.assertOwner(key, 'user-456')).toThrow(BadRequestException);
    expect(() => adapter.assertOwner('user-123/sub/file.png', 'user-123')).toThrow(BadRequestException);
    expect(() => adapter.assertOwner('../user-123/file.png', 'user-123')).toThrow(BadRequestException);
    expect(() => adapter.assertOwner('user-123/file.png?x=1', 'user-123')).toThrow(BadRequestException);
  });

  it('builds a URL from the server-generated key only', () => {
    const key = 'user-123/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png';
    expect(adapter.urlForKey(key, 'http://localhost:3001/')).toBe(
      `http://localhost:3001/uploads/${key}`,
    );
  });
});
