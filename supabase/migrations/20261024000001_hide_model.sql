-- The AI model behind an audit is internal. It stays recorded for
-- reproducibility (audits.model_version, agent_runs.served_model) but signed-in
-- users can no longer read those columns, nor the raw agent output and usage.
-- System work (service role / postgres) is unaffected.

revoke select on public.audits from authenticated;
grant select (id, org_id, company_id, date, status, trigger, score, raw_score, exposure, cap, base_directive, final_directive,
  overridden, override, override_cited, override_rejected, score_excluding_dismissed, coverage, skipped_sections, orchestrator,
  prompt_version, calibration_version, input_snapshot, snapshot_hash, source_ids, drift_flag, under_review, hold_resolution,
  counted_against_usage, first_checkpoint, final_checkpoint, outcome_window_version, run_state, run_seconds, started_at,
  finished_at, notify_on_complete, created_by, created_at) on public.audits to authenticated;

revoke select on public.agent_runs from authenticated;
grant select (id, audit_id, org_id, agent, status, duration_s, retry_count, error_reason, schema_result, fallback_used,
  started_at, finished_at) on public.agent_runs to authenticated;
