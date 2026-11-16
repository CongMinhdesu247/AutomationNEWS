ALTER TABLE news_sources ADD COLUMN catalog_rank smallint CHECK (catalog_rank > 0);

-- Starter channels use the publishers' public RSS endpoints. Keep any
-- existing approval decision for an address already in the database.
INSERT INTO news_sources (id, name, url, status, catalog_rank)
VALUES
  (gen_random_uuid(), 'VnExpress · Tin mới', 'https://vnexpress.net/rss/tin-moi-nhat.rss', 'approved', 10),
  (gen_random_uuid(), 'VnExpress · Kinh doanh', 'https://vnexpress.net/rss/kinh-doanh.rss', 'approved', 20),
  (gen_random_uuid(), 'Tuổi Trẻ · Giáo dục', 'https://tuoitre.vn/rss/giao-duc.rss', 'approved', 30),
  (gen_random_uuid(), 'VietNamNet · Sức khỏe', 'https://vietnamnet.vn/suc-khoe.rss', 'approved', 40),
  (gen_random_uuid(), 'Bộ Khoa học và Công nghệ', 'https://spdv.mic.gov.vn/rss/home.rss', 'approved', 50)
ON CONFLICT (url) DO UPDATE SET catalog_rank = EXCLUDED.catalog_rank;
