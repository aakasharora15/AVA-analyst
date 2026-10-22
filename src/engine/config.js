// Scoring configuration (spec 4.0). The values live in config/engine.json so
// the JavaScript and Python engines can never disagree. [CALIBRATE]

import cfg from '../../config/engine.json' with { type: 'json' };

export const AGENTS = cfg.agents;
// Report sections, 13 in total. Agents 1 to 5 return findings per section;
// the Orchestrator's sections hold its rationale, not findings.
export const SECTIONS = cfg.sections;
export const CATEGORIES = cfg.categories;
export const SEVERITIES = cfg.severities;
export const DIRECTIVES = cfg.directives; // low to high
export const VENTURE_TYPES = cfg.ventureTypes;
export const AUDIT_STATUSES = cfg.auditStatuses;

export const CALIBRATIONS = cfg.calibrations;
export const CALIBRATION = cfg.calibrations[cfg.currentCalibration];
// The previous calibration version, kept so older audits can be re-scored or
// labelled in a compare.
export const PREVIOUS_CALIBRATION = cfg.calibrations['cal-2026.1'];

export const ALERT_RULES = cfg.alertRules;
// Outcome windows (spec 4.16). Versioned; a change applies only to later audits. [CALIBRATE]
export const OUTCOME_WINDOW = cfg.outcomeWindow;
export const DRIFT = cfg.drift;
