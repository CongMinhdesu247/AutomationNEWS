-- Separate, bounded search billing; provider tools in the Gemini adapter remain disabled.
ALTER TABLE news_usage DROP CONSTRAINT news_usage_reserved_tokens_check;
ALTER TABLE news_usage ADD CONSTRAINT news_usage_reserved_tokens_check CHECK(reserved_tokens>=0);
ALTER TABLE news_usage ADD COLUMN reserved_search_units integer NOT NULL DEFAULT 0 CHECK(reserved_search_units BETWEEN 0 AND 1);
UPDATE news_ai_control SET config=config || '{"searchProvider":"disabled","searchUnitMicros":0,"searchPricingVersion":"","dailySearchUnits":0,"monthlySearchUnits":0,"searchStorageAllowed":false}';
CREATE TABLE news_discovery_cache (
 cache_key text PRIMARY KEY,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX news_discovery_cache_created_idx ON news_discovery_cache(created_at);
CREATE INDEX news_tasks_discovery_key_idx ON news_tasks((payload->>'cacheKey')) WHERE kind='discover';
