-- ============================================================
-- 0005_grayscale.sql — per-source grayscale rollout control
-- ============================================================

-- grayscale_pct: 0 = paused, 100 = fully live (default).
-- The ingestion fanout samples Math.random()*100 < grayscale_pct
-- so you can ramp a source from 10 → 100 without touching code.
ALTER TABLE sources
  ADD COLUMN grayscale_pct INT NOT NULL DEFAULT 100;

-- Keep values in [0,100]. MySQL 8.0.16+ enforces CHECK constraints.
ALTER TABLE sources
  ADD CONSTRAINT chk_grayscale_pct CHECK (grayscale_pct BETWEEN 0 AND 100);
