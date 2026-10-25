// Human wording for alerts, shared by the panel and the Alerts screen.

export const TRIGGER_LABEL = {
  directive: 'Directive change',
  score: 'Score move',
  high: 'New HIGH finding',
  evidence: 'New evidence',
  metrics: 'Numbers moved',
};

export function alertTitle(a) {
  switch (a.trigger) {
    case 'directive':
      return `Directive changed from ${a.fromDirective} to ${a.toDirective}${a.causedByOverride ? ' (Orchestrator override)' : ''}`;
    case 'score': {
      const d = a.toScore - a.fromScore;
      return `Score ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} to ${a.toScore}`;
    }
    case 'high':
      return 'New HIGH finding';
    case 'evidence':
      return a.detail || 'New evidence added to the data room';
    case 'metrics':
      return a.detail || 'Reported numbers moved materially';
    default:
      return 'Alert';
  }
}
