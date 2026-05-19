-- Cache the upstream blogger avatar URL alongside display_name.
--
-- For X / Twitter this is `legacy.profile_image_url_https` (e.g. the small
-- _normal.jpg variant). We strip the size suffix at read time to upgrade
-- to _400x400 when rendering big profile heads.
--
-- Stored verbatim from the platform CDN. Public read path passes the URL
-- through `proxiedImage(url, sourceId)` so the X-Referer / cookie dance
-- happens server-side, never leaking the upstream cookie to the browser.
ALTER TABLE sources
  ADD COLUMN avatar_url VARCHAR(512) NULL AFTER display_name;
