const readAsDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** 将本地图标缩放并转为 WebP，避免把数 MB 原图塞进 localStorage。 */
export async function optimizeIconFile(file: File, maxSide = 256): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持图片压缩');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (!blob) throw new Error('图片压缩失败');
    return readAsDataUrl(blob);
  } finally {
    bitmap.close();
  }
}
