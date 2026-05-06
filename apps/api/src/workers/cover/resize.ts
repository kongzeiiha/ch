import sharp from 'sharp';

export const SIZES = {
  card: { w: 600, h: 400 },    // 列表卡片
  og: { w: 1200, h: 630 },     // Open Graph
  thumb: { w: 240, h: 160 },   // 缩略
} as const;

export type SizeName = keyof typeof SIZES;

export async function renderSizes(buffer: Buffer): Promise<Record<SizeName, Buffer>> {
  const entries = Object.entries(SIZES) as [SizeName, { w: number; h: number }][];
  const rendered = await Promise.all(
    entries.map(async ([name, { w, h }]) => {
      const out = await sharp(buffer)
        .rotate()
        .resize(w, h, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      return [name, out] as const;
    }),
  );
  return Object.fromEntries(rendered) as Record<SizeName, Buffer>;
}
