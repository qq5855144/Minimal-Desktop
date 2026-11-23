import { z } from 'zod';

export const CLOUD_DRIVE_CHUNK_BYTES = 8 * 1024 * 1024;
const id = z.string().uuid();
const name = z.string().trim().min(1).max(255).refine((value) => (
  value !== '.' && value !== '..' && !/[\\/]/.test(value)
), '名称不能包含路径分隔符');
const parent = id.nullable().optional();

export const driveFileSchema = z.object({
  id,
  name: z.string().min(1).max(255),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  uploadedAt: z.string().datetime(),
  folderId: parent,
  chunkSize: z.literal(CLOUD_DRIVE_CHUNK_BYTES).optional(),
  mime: z.string().max(255).optional(),
});

export const driveFolderSchema = z.object({
  id, name, folderId: parent,
});

const driveIndexSchema = z.object({
  files: z.array(driveFileSchema),
  folders: z.array(driveFolderSchema),
});

export type CloudDriveFile = z.infer<typeof driveFileSchema>;
export type CloudDriveFolder = z.infer<typeof driveFolderSchema>;
export type CloudDriveIndex = z.infer<typeof driveIndexSchema>;

export function parseCloudDriveIndex(value: unknown): CloudDriveIndex {
  const parsed = driveIndexSchema.safeParse(Array.isArray(value) ? { files: value, folders: [] } : value);
  if (!parsed.success) throw new Error('云盘索引格式无效');
  const index = parsed.data;
  const folders = new Map(index.folders.map((folder) => [folder.id, folder]));
  const items = [...index.files, ...index.folders];
  if (new Set(items.map((entry) => entry.id)).size !== items.length
    || items.some((item) => item.folderId && !folders.has(item.folderId))) {
    throw new Error('云盘索引包含无效的文件夹');
  }
  for (const folder of index.folders) {
    const seen = new Set<string>([folder.id]);
    let parentId = folder.folderId;
    while (parentId) {
      if (seen.has(parentId)) throw new Error('云盘文件夹包含循环引用');
      seen.add(parentId);
      parentId = folders.get(parentId)?.folderId;
    }
  }
  return index;
}

export function driveEntryName(value: string): string {
  const parsed = name.safeParse(value);
  if (!parsed.success) throw new Error('请输入有效的文件或文件夹名称');
  return parsed.data;
}

export function driveFolderSubtree(folders: CloudDriveFolder[], id: string): Set<string> {
  const ids = new Set([id]);
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.folderId) continue;
    const group = children.get(folder.folderId) ?? [];
    group.push(folder.id);
    children.set(folder.folderId, group);
  }
  for (const parentId of ids) {
    for (const childId of children.get(parentId) ?? []) ids.add(childId);
  }
  return ids;
}

export function* driveFileParts(file: CloudDriveFile): Generator<{ path: string; offset: number; size: number }> {
  const base = 'drive/files/' + file.id;
  if (!file.chunkSize) {
    yield { path: base + '.bin', offset: 0, size: file.size };
    return;
  }
  for (let offset = 0, part = 0; offset < file.size; offset += file.chunkSize, part++) {
    yield { path: base + '/' + part + '.bin', offset, size: Math.min(file.chunkSize, file.size - offset) };
  }
}
