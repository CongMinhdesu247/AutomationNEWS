-- Keep a general-news choice when the primary address already exists with
-- an administrator's decision that makes it unavailable to members.
INSERT INTO news_sources (id, name, url, status, catalog_rank)
SELECT gen_random_uuid(), 'VnExpress · Thời sự', 'https://vnexpress.net/rss/thoi-su.rss', 'approved', 15
WHERE NOT EXISTS (
  SELECT 1 FROM news_sources WHERE catalog_rank = 10 AND status = 'approved'
)
ON CONFLICT (url) DO UPDATE SET catalog_rank = EXCLUDED.catalog_rank;
