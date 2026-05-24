CREATE TABLE IF NOT EXISTS registries (
  authority varchar(255) PRIMARY KEY,
  base_url text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  event_count integer NOT NULL DEFAULT 0
);
