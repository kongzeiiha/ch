import sharp from 'sharp';

export const SIZES = {
  card: { w: 600, h: 400 },    // 列表卡片
  og: { w: 1200, h: 630 },     // Open Graph
  thumb: { w: 240, h: 160 },   // 缩略
} as const;

export type SizeName = keyof typeof SIZES;

export async function renderSizes(buffer: Buffer): Promise<Record<SizeName, Buffer>> {
  const out = {} as Record<SizeName, Buffer>;
  for (const [name, { w, h }] of Object.entries(SIZES) as [SizeName, { w: number; h: number }][]) {
    out[name] = await sharp(buffer)
      .rotate()
      .resize(w, h, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  }
  return out;
}
