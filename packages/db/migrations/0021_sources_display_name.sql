-- Cache the upstream platform's user-facing display name.
--
-- For X / Twitter the `sources.name` column ends up holding the @handle
-- (urgseukekcbdnrb), but the actual blogger-facing display string the user
-- sees on x.com is the profile "name" field — Chinese / Thai / emoji-laden
-- like "我在故宫胡吃海喝". This column caches that, populated by the X
-- adapter when it resolves the user via UserByScreenName during fanout.
--
-- Read path uses COALESCE(display_name, name) so legacy sources without a
-- cached display_name keep showing the existing name unchanged.
ALTER TABLE sources
  ADD COLUMN display_name VARCHAR(128) NULL AFTER name;
