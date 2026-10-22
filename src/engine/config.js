// Scoring configuration (spec 4.0). Every number here is a starting value to
// be tuned on real ventures with known outcomes before launch. [CALIBRATE]
// The bands are the spec's approved starting values.

export const AGENTS = [
  { n: 1, id: 'saboteur', name: 'The Saboteur', mandate: 'Internal failure: operations, waste, team, unit economics.' },
  { n: 2, id: 'predator', name: 'The Predator', mandate: 'Competitive attack: how a funded incumbent would break the moat.' },
  { n: 3, id: 'copycat', name: 'The Copycat', mandate: 'Market saturation: how fast and cheaply the idea can be cloned.' },
  { n: 4, id: 'spectator', name: 'The Spectator', mandate: 'Customer demand and financial runway.' },
  { n: 5, id: 'sentinel', name: 'The Sentinel', mandate: 'Regulation, compliance, legal and IP exposure.' },
  { n: 6, id: 'orchestrator', name: 'The Orchestrator', mandate: 'Weighs all five reports, writes the rationale and may move the directive one band down.' },
];

// Report sections, 13 in total. Agents 1 to 5 return findings per section;
// the Orchestrator's sections hold its rationale, not findings.
export const SECTIONS = [
  { id: 'exec', agent: 1, title: 'Executive risk summary' },
  { id: 'ops', agent: 1, title: 'Operational risks' },
  { id: 'fin', agent: 1, title: 'Financial risks' },
  { id: 'fail', agent: 1, title: 'Failure probability indicators' },
  { id: 'comp', agent: 2, title: 'Competitor attack analysis' },
  { id: 'geo', agent: 2, title: 'Regional and geographic challenges' },
  { id: 'sat', agent: 3, title: 'Market saturation' },
  { id: 'dem', agent: 4, title: 'Customer demand and runway' },
  { id: 'psy', agent: 4, title: 'Customer psychology risks' },
  { id: 'reg', agent: 5, title: 'Regulation and compliance' },
  { id: 'ip', agent: 5, title: 'Legal and IP exposure' },
  { id: 'inv', agent: 6, title: 'Investor perspective and recommendations' },
  { id: 'dir', agent: 6, title: 'Final directive and roadmap' },
];

export const CATEGORIES = ['Market', 'Financial', 'Operational', 'Competition', 'Customer psychology', 'Geographic', 'Regulatory'];
export const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'];
export const DIRECTIVES = ['KILL', 'PIVOT', 'HOLD', 'PROCEED']; // low to high
export const VENTURE_TYPES = ['startup', 'strategy', 'campaign'];
export const AUDIT_STATUSES = ['queued', 'running', 'complete', 'partial', 'failed'];

export const CALIBRATION = {
  version: 'cal-2026.2',
  // Exposure points each finding adds to its category. [CALIBRATE]
  severityWeights: { HIGH: 22, MEDIUM: 12, LOW: 5 },
  // Category weights per venture type; each set sums to 1. [CALIBRATE]
  categoryWeights: {
    startup: { Market: 0.15, Financial: 0.2, Operational: 0.15, Competition: 0.15, 'Customer psychology': 0.1, Geographic: 0.1, Regulatory: 0.15 },
    strategy: { Market: 0.2, Financial: 0.2, Operational: 0.2, Competition: 0.15, 'Customer psychology': 0.1, Geographic: 0.05, Regulatory: 0.1 },
    campaign: { Market: 0.2, Financial: 0.1, Operational: 0.1, Competition: 0.15, 'Customer psychology': 0.3, Geographic: 0.05, Regulatory: 0.1 },
  },
  // Cap rule: any category above the threshold limits the maximum score. [CALIBRATE]
  cap: { threshold: 85, maxScore: 39 },
  // Lowest score in each band (spec 4.0 starting values).
  bands: { KILL: 0, PIVOT: 35, HOLD: 45, PROCEED: 65 },
};

// The previous calibration version, kept so older audits can be re-scored or
// labelled in a compare.
export const PREVIOUS_CALIBRATION = {
  ...CALIBRATION,
  version: 'cal-2026.1',
  severityWeights: { HIGH: 24, MEDIUM: 12, LOW: 4 },
};

export const CALIBRATIONS = {
  [CALIBRATION.version]: CALIBRATION,
  [PREVIOUS_CALIBRATION.version]: PREVIOUS_CALIBRATION,
};

export const ALERT_RULES = {
  bandCrossMargin: 2, // score must cross a band edge by this many points
  scoreMove: 5,       // score move that triggers an alert
};

// Outcome windows (spec 4.16). Versioned; a change applies only to later audits. [CALIBRATE]
export const OUTCOME_WINDOW = { version: 'ow-1', firstMonths: 12, finalMonths: 24 };
