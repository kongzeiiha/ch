-- Public comment threads keyed by item_id.
-- No user accounts site-wide; comments are anonymous with a client-provided
-- display name (defaulting to "匿名") and an LS-generated anon_id used only
-- for client-side dedup / "my comment" recognition. Server rate-limits per
-- IP+UA fingerprint via Redis, not via anon_id (which the client can rotate).
--
-- item_id FK so deleting an article cascades comments (avoids dangling rows
-- and shows /admin a clean state). slug isn't stored — looked up from items
-- at write time and joined back on read.
CREATE TABLE IF NOT EXISTS comments (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  item_id      CHAR(36)     NOT NULL,
  anon_id      VARCHAR(64)  NOT NULL,
  display_name VARCHAR(32)  NOT NULL,
  body         TEXT         NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comments_item_created (item_id, created_at DESC),
  CONSTRAINT fk_comments_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
