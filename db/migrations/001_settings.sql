CREATE TABLE settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id, config) VALUES (1, '{
  "newsletter": {"enabled": true, "sendTime": "07:00", "timezone": "Asia/Ho_Chi_Minh"},
  "rss": [],
  "weather": {"enabled": false, "location": "", "latitude": 0, "longitude": 0},
  "github": {"enabled": false, "topics": [], "languages": [], "repositoryCount": 5},
  "notifications": {"enabled": false, "serverUrl": "https://ntfy.sh/", "topic": ""}
}'::jsonb) ON CONFLICT (id) DO NOTHING;
