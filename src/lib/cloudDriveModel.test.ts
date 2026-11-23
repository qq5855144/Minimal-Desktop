import { describe, expect, it } from 'vitest';
import { CLOUD_DRIVE_CHUNK_BYTES, driveFileParts, parseCloudDriveIndex } from './cloudDriveModel';

const id = '123e4567-e89b-42d3-a456-426614174000';
const other = '123e4567-e89b-42d3-a456-426614174001';
const original = { id, name: '旧文件', size: 0, uploadedAt: '2026-01-01T00:00:00Z' };

describe('cloud drive index', () => {
  it('keeps legacy binary paths when reading an older flat index', () => {
    const index = parseCloudDriveIndex([original]);
    expect(index).toEqual({ files: [original], folders: [] });
    expect([...driveFileParts(index.files[0])]).toEqual([
      { path: 'drive/files/' + id + '.bin', offset: 0, size: 0 },
    ]);
  });

  it('rejects cycles and missing directory references', () => {
    expect(() => parseCloudDriveIndex({
      files: [], folders: [{ id, name: 'A', folderId: other }, { id: other, name: 'B', folderId: id }],
    })).toThrow('循环引用');
    expect(() => parseCloudDriveIndex({ files: [{ ...original, folderId: other }], folders: [] })).toThrow('无效的文件夹');
  });

  it('uses the recorded chunk size to build the final short chunk', () => {
    const bytes = CLOUD_DRIVE_CHUNK_BYTES * 4 + 71;
    const index = parseCloudDriveIndex({ files: [{ ...original, size: bytes, chunkSize: CLOUD_DRIVE_CHUNK_BYTES }], folders: [] });
    const parts = [...driveFileParts(index.files[0])];
    expect(parts.map((part) => part.size)).toEqual([...Array(4).fill(CLOUD_DRIVE_CHUNK_BYTES), 71]);
    expect(parts[4]).toEqual({ path: 'drive/files/' + id + '/4.bin', offset: CLOUD_DRIVE_CHUNK_BYTES * 4, size: 71 });
  });
});
