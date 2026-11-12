-- Owner-managed family configuration; the dashboard remains bound to loopback.
-- Atomic document replacement plus revision guards prevents lost edits in two tabs.
CREATE TABLE family_configuration (
  id smallint PRIMARY KEY CHECK (id = 1),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  synced_revision integer CHECK (synced_revision > 0 AND synced_revision <= revision),
  synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
