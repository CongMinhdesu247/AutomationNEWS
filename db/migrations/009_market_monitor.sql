-- Public observed prices and delivery reservations only; no topics or secrets.
CREATE TABLE market_monitor (
  id smallint PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{"version":1,"snapshots":[],"deliveries":{}}'::jsonb,
  checked_at timestamptz
);
INSERT INTO market_monitor(id) VALUES (1);
