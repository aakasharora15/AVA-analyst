-- Reference rows: the current calibration versions and outcome window (spec 4.0, 4.16).
-- Values mirror config/engine.json. [CALIBRATE]

insert into public.calibration_versions (version, model_version, prompt_version, weights, released_at)
values
  ('cal-2026.1', 'claude-opus-5-5', 'prompts-2026.09', '{"severityWeights": {"HIGH": 24, "MEDIUM": 12, "LOW": 4}}', '2026-01-01'),
  ('cal-2026.2', 'claude-opus-5-5', 'prompts-2026.10', '{"severityWeights": {"HIGH": 22, "MEDIUM": 12, "LOW": 5}}', '2026-07-01')
on conflict (version) do nothing;

insert into public.outcome_window_versions (version, first_months, final_months, effective_from)
values ('ow-1', 12, 24, '2026-01-01')
on conflict (version) do nothing;

-- Members can read reference tables (no secrets in them).
create policy calibration_versions_read on public.calibration_versions for select using (true);
create policy outcome_windows_read on public.outcome_window_versions for select using (true);

-- System organisation that holds free audits until the email domain converts (spec 4.11).
insert into public.organisations (id, name, kind) values ('free-audits', 'Free audits (system)', 'VC fund')
on conflict (id) do nothing;
