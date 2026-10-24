import landing from './screens/landing.js';
import pricing from './screens/pricing.js';
import team from './screens/team.js';
import freeAudit from './screens/free-audit.js';
import signIn from './screens/sign-in.js';
import onboarding from './screens/onboarding.js';
import portfolio from './screens/portfolio.js';
import company from './screens/company.js';
import newAnalysis from './screens/new-analysis.js';
import running from './screens/running.js';
import report from './screens/report.js';
import history from './screens/history.js';
import sources from './screens/sources.js';
import benchmarks from './screens/benchmarks.js';
import outcomes from './screens/outcomes.js';
import alerts from './screens/alerts.js';
import dataRoom from './screens/data-room.js';
import exportScreen from './screens/export.js';
import account from './screens/account.js';
import { shared, invite, noAccess, maintenance, privacy, terms, trust, demo } from './screens/misc.js';

// layout: 'public' = site header and footer; 'app' = signed-in app header;
// 'bare' = no chrome.
export const routes = [
  // Public
  { path: '/', screen: { ...landing, className: 'landing' }, layout: 'public', large: true },
  { path: '/pricing', screen: { ...pricing, className: 'pricing' }, layout: 'public' },
  { path: '/team', screen: { ...team, className: 'team' }, layout: 'public' },
  { path: '/free-audit', screen: freeAudit, layout: 'public' },
  { path: '/sign-in', screen: signIn, layout: 'bare' },
  { path: '/privacy', screen: privacy, layout: 'public' },
  { path: '/terms', screen: terms, layout: 'public' },
  { path: '/trust', screen: trust, layout: 'public' },
  { path: '/maintenance', screen: maintenance, layout: 'public' },
  { path: '/shared/:token', screen: shared, layout: 'bare' },
  { path: '/invite/:token', screen: invite, layout: 'public' },

  // App
  { path: '/onboarding', screen: onboarding, layout: 'bare', auth: true },
  { path: '/portfolio', screen: portfolio, layout: 'app' },
  { path: '/company/:id', screen: company, layout: 'app' },
  { path: '/new-analysis', screen: newAnalysis, layout: 'app' },
  { path: '/running/:auditId', screen: running, layout: 'app' },
  { path: '/report/:auditId', screen: report, layout: 'app' },
  { path: '/history/:companyId', screen: history, layout: 'app' },
  { path: '/sources', screen: sources, layout: 'app' },
  { path: '/benchmarks', screen: benchmarks, layout: 'app' },
  { path: '/outcomes', screen: outcomes, layout: 'app' },
  { path: '/alerts', screen: alerts, layout: 'app' },
  { path: '/data-room', screen: dataRoom, layout: 'app' },
  { path: '/export', screen: exportScreen, layout: 'app' },
  { path: '/account', screen: account, layout: 'app' },
  { path: '/no-access', screen: noAccess, layout: 'app' },
  { path: '/demo', screen: demo, layout: 'bare' },
];
