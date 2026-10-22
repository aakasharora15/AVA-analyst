import landing from './screens/landing.js';
import pricing from './screens/pricing.js';
import team from './screens/team.js';
import { planned } from './screens/planned.js';

// layout: 'public' renders the site header and footer around the screen.
export const routes = [
  // Public
  { path: '/', screen: { ...landing, className: 'landing' }, layout: 'public', large: true },
  { path: '/pricing', screen: { ...pricing, className: 'pricing' }, layout: 'public' },
  { path: '/team', screen: { ...team, className: 'team' }, layout: 'public' },
  { path: '/free-audit', screen: planned({ name: 'Free audit', phase: 5 }), layout: 'public' },
  { path: '/sign-in', screen: planned({ name: 'Sign in', phase: 5 }), layout: 'public' },

  // App
  { path: '/onboarding', screen: planned({ name: 'Onboarding', phase: 5 }), layout: 'public' },
  { path: '/portfolio', screen: planned({ name: 'Portfolio', phase: 3 }), layout: 'public' },
  { path: '/company/:id', screen: planned({ name: 'Company', phase: 3 }), layout: 'public' },
  { path: '/new-analysis', screen: planned({ name: 'New analysis', phase: 2 }), layout: 'public' },
  { path: '/running/:auditId', screen: planned({ name: 'Running audit', phase: 2 }), layout: 'public' },
  { path: '/report/:auditId', screen: planned({ name: 'Report', phase: 2 }), layout: 'public' },
  { path: '/history/:companyId', screen: planned({ name: 'Audit history', phase: 3 }), layout: 'public' },
  { path: '/sources', screen: planned({ name: 'Sources', phase: 4 }), layout: 'public' },
  { path: '/benchmarks', screen: planned({ name: 'Benchmarks', phase: 4 }), layout: 'public' },
  { path: '/outcomes', screen: planned({ name: 'Outcomes', phase: 4 }), layout: 'public' },
  { path: '/alerts', screen: planned({ name: 'Alerts', phase: 4 }), layout: 'public' },
  { path: '/data-room', screen: planned({ name: 'Data room', phase: 4 }), layout: 'public' },
  { path: '/export', screen: planned({ name: 'Export', phase: 5 }), layout: 'public' },
  { path: '/account', screen: planned({ name: 'Account', phase: 5 }), layout: 'public' },
];
