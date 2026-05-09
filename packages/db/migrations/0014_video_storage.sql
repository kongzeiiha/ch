-- ============================================================
-- 0014_video_storage.sql
-- raw_items.video_urls: 我们 MinIO 里的视频地址(下载后的镜像)
-- 区别于 raw_payload.extra.videoUrls(原始 X CDN 直链,可能失效)
-- ============================================================

ALTER TABLE raw_items
  ADD COLUMN video_urls JSON NOT NULL DEFAULT (JSON_ARRAY());
