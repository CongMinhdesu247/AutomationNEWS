-- We Work Remotely publishes these category feeds for reuse with attribution.
-- Keep its name and original listing links, and honor existing approval decisions.
INSERT INTO news_sources (id, name, url, status, catalog_rank)
VALUES
  (gen_random_uuid(), 'We Work Remotely · Lập trình full-stack từ xa', 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss', 'approved', 60),
  (gen_random_uuid(), 'We Work Remotely · Hỗ trợ khách hàng từ xa', 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss', 'approved', 70)
ON CONFLICT (url) DO UPDATE SET catalog_rank = EXCLUDED.catalog_rank;
