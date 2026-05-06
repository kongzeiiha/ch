-- agent_runs is append-only and queried almost exclusively by time window
-- (alerts, ops dashboard, cost reports). Without this index every
-- WHERE started_at >= NOW() - INTERVAL ... is a sequential scan.
CREATE INDEX idx_agent_runs_started_at
  ON agent_runs (started_at);
