-- Sends one test copy of each AVA email type to one address, through the real
-- pipeline (outbox -> ava-email cron -> Resend). Costs no model credit.
-- Run in the Supabase SQL editor after replacing the address on the next line.
-- The emails arrive within 5 minutes. Links in them point at sample pages.

with t(addr) as (values ('you@example.com'))
insert into public.email_outbox (to_email, subject, body, kind)
select addr, s.subject, s.body || E'\n\n--\nManage alert settings: https://avaverdict.com/alerts\nUnsubscribe: https://avaverdict.com/account?tab=profile&unsubscribe=1\n', s.kind
from t, (values
  ('[TEST] Sample Venture: audit complete, HOLD 52',
   'Open the report: https://avaverdict.com/dashboard',
   'audit-complete'),
  ('[TEST] Sample Venture: directive changed from PROCEED to PIVOT',
   E'[TEST] Sample Venture: directive changed from PROCEED to PIVOT.\nScore 71 to 38.\nCompare the audits: https://avaverdict.com/alerts',
   'alert-immediate'),
  ('[TEST] AVA weekly digest: 2 alerts',
   E'This week across your portfolio:\n\nSample Venture: directive changed from PROCEED to PIVOT\nSample Venture: new HIGH finding\n\nOpen alerts: https://avaverdict.com/alerts',
   'digest'),
  ('[TEST] Sample Fund: your October 2026 numbers for Sample Venture',
   E'Sample Fund tracks Sample Venture with AVA. Please share your numbers for October 2026: revenue, cash, monthly burn, headcount and customers. It takes about two minutes and needs no account.\n\nhttps://avaverdict.com/\n\nThe link is private to you and expires in 14 days.',
   'metrics'),
  ('[TEST] Your free AVA audit of Sample Venture: PROCEED, score 81',
   E'Your free audit of Sample Venture is ready.\n\nResilience Score 81 of 100. Directive PROCEED.\n\nRead your top three findings: https://avaverdict.com/free-audit\n\nThe link is private to you.',
   'free-audit-result')
) as s(subject, body, kind);

-- Check after 5 minutes: sent_at filled and error empty means Resend accepted it.
-- select subject, sent_at, error from public.email_outbox where subject like '[TEST]%' order by id desc;
