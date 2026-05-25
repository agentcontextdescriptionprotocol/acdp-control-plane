CREATE INDEX IF NOT EXISTS ce_run_idx     ON context_events(run_id);
CREATE INDEX IF NOT EXISTS ce_ctx_idx     ON context_events(ctx_id);
CREATE INDEX IF NOT EXISTS ce_ts_idx      ON context_events(event_ts);
CREATE INDEX IF NOT EXISTS ce_agent_idx   ON context_events(agent_id);
CREATE INDEX IF NOT EXISTS ce_lineage_idx ON context_events(lineage_id);
CREATE INDEX IF NOT EXISTS ce_type_idx    ON context_events(event_type);

CREATE INDEX IF NOT EXISTS runs_status_idx   ON runs(status);
CREATE INDEX IF NOT EXISTS runs_scenario_idx ON runs(scenario_id);
CREATE INDEX IF NOT EXISTS runs_started_idx  ON runs(started_at);

CREATE INDEX IF NOT EXISTS le_to_idx   ON lineage_edges(to_ctx_id);
CREATE INDEX IF NOT EXISTS le_from_idx ON lineage_edges(from_ctx_id);
CREATE INDEX IF NOT EXISTS le_run_idx  ON lineage_edges(run_id);

CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_idx ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx  ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS webhook_deliveries_run_idx     ON webhook_deliveries(run_id);
