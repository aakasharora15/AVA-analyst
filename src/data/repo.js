// Data layer entry point. Screens import from here only.
//
// `ava:repo` is resolved at build time (vite.config.js) from VITE_AVA_DATA:
// `mock` (default) is the in-browser demo in repo.mock.js; `live` is Supabase
// plus the AVA API in repo.live.js. Both export the same functions and shapes.
//
// Public demo workspace: in a live build, signing in with the demo
// credentials (or opening /demo) switches this browser to repo.mock.js with
// the sample portfolio. It never touches the database, the Claude API or
// email, each visitor gets their own copy, and signing out returns to the
// live layer.

import * as primary from 'ava:repo';
import { load, save, remove } from '../lib/storage.js';

export const DEMO_EMAIL = 'demo@avaverdict.com';
export const DEMO_PASSWORD = 'VerdictDemo2026';
const DEMO_KEY = 'demo-workspace';

const demoAvailable = primary.MODE === 'live';
let demoOn = demoAvailable && load(DEMO_KEY) === true;
// The sample data layer is downloaded only by visitors who open the demo.
// In a mock build it is the same module as `primary`.
let sample = demoAvailable ? null : primary;
const loadSample = async () => { sample = sample || await import('./repo.mock.js'); return sample; };
if (demoOn) await loadSample();
const impl = () => (demoOn ? sample : primary);

// Live bindings: screens importing these see the change when the demo starts or ends.
export let MODE = demoOn ? 'mock' : primary.MODE;
export let SAMPLE = impl().SAMPLE;
/** True only for the public demo workspace inside a live build. */
export let DEMO = demoOn;

function setDemo(on) {
  demoOn = demoAvailable && on;
  if (demoOn) save(DEMO_KEY, true); else remove(DEMO_KEY);
  MODE = demoOn ? 'mock' : primary.MODE;
  SAMPLE = impl().SAMPLE;
  DEMO = demoOn;
}

export const isDemoCredentials = (email, password) =>
  String(email || '').trim().toLowerCase() === DEMO_EMAIL && String(password || '') === DEMO_PASSWORD;

/** Open a fresh demo workspace with the sample portfolio, signed in as the sample Owner. */
export async function enterDemo() {
  await loadSample();
  if (!demoAvailable) { await sample.signIn('alex@yourfund.example'); return; }
  if (!demoOn) await primary.signOut().catch(() => {});
  setDemo(true);
  await sample.resetDemo();
  await sample.signIn('alex@yourfund.example');
}

export async function signIn(email, password) {
  if (isDemoCredentials(email, password)) { await enterDemo(); return sample.getCurrentUser(); }
  if (demoOn) setDemo(false);
  return primary.signIn(email, password);
}

/** Returns where to go next: the landing page after the demo, sign-in otherwise. */
export async function signOut() {
  if (demoOn) {
    await sample.signOut();
    setDemo(false);
    return '/';
  }
  await primary.signOut();
  return '/sign-in';
}

export const AGENTS = primary.AGENTS;
export const SECTIONS = primary.SECTIONS;
export const CATEGORIES = primary.CATEGORIES;

export const can = (...a) => impl().can(...a);
export const effectiveCadence = (...a) => impl().effectiveCadence(...a);
// The free audit is a public page: it always runs for real, even in a browser
// that has the demo workspace open.
export const checkWorkEmail = (...a) => primary.checkWorkEmail(...a);

export const getSession = (...a) => impl().getSession(...a);
export const signUp = (...a) => impl().signUp(...a);
export const signInWithProvider = (...a) => impl().signInWithProvider(...a);
export const takeAuthError = () => primary.takeAuthError();
export const requestPasswordReset = (...a) => impl().requestPasswordReset(...a);
export const resendVerification = (...a) => impl().resendVerification(...a);
export const updatePassword = (...a) => impl().updatePassword(...a);
export const signInWithSso = (...a) => impl().signInWithSso(...a);
export const completeOnboarding = (...a) => impl().completeOnboarding(...a);
export const getOrg = (...a) => impl().getOrg(...a);
export const updateOrg = (...a) => impl().updateOrg(...a);
export const getUsers = (...a) => impl().getUsers(...a);
export const getCurrentUser = (...a) => impl().getCurrentUser(...a);
export const updateProfile = (...a) => impl().updateProfile(...a);
export const actAs = (...a) => impl().actAs(...a);
export const inviteMember = (...a) => impl().inviteMember(...a);
export const changeRole = (...a) => impl().changeRole(...a);
export const transferOwnership = (...a) => impl().transferOwnership(...a);
export const getInvite = (...a) => impl().getInvite(...a);
export const acceptInvite = (...a) => impl().acceptInvite(...a);
export const removeMember = (...a) => impl().removeMember(...a);
export const getCompanies = (...a) => impl().getCompanies(...a);
export const getCompany = (...a) => impl().getCompany(...a);
export const toggleTodo = (...a) => impl().toggleTodo(...a);
export const updateCompany = (...a) => impl().updateCompany(...a);
export const getAudits = (...a) => impl().getAudits(...a);
export const getAudit = (...a) => impl().getAudit(...a);
export const getLatestAuditId = (...a) => impl().getLatestAuditId(...a);
export const runAudit = (...a) => impl().runAudit(...a);
export const notifyOnComplete = (...a) => impl().notifyOnComplete(...a);
export const setRunDebug = (...a) => impl().setRunDebug(...a);
export const getRun = (...a) => impl().getRun(...a);
export const setFindingStatus = (...a) => impl().setFindingStatus(...a);
export const setFindingOwner = (...a) => impl().setFindingOwner(...a);
export const addComment = (...a) => impl().addComment(...a);
export const challengeFinding = (...a) => impl().challengeFinding(...a);
export const answerChallenge = (...a) => impl().answerChallenge(...a);
export const getQuestions = (...a) => impl().getQuestions(...a);
export const askQuestion = (...a) => impl().askQuestion(...a);
export const getSources = (...a) => impl().getSources(...a);
export const uploadFiles = (...a) => impl().uploadFiles(...a);
export const getAlerts = (...a) => impl().getAlerts(...a);
export const markAlertRead = (...a) => impl().markAlertRead(...a);
export const markAllAlertsRead = (...a) => impl().markAllAlertsRead(...a);
export const snoozeCompany = (...a) => impl().snoozeCompany(...a);
export const unsnoozeCompany = (...a) => impl().unsnoozeCompany(...a);
export const unreadAlertCount = (...a) => impl().unreadAlertCount(...a);
export const getOutcomeRows = (...a) => impl().getOutcomeRows(...a);
export const logOutcome = (...a) => impl().logOutcome(...a);
export const createShareLink = (...a) => impl().createShareLink(...a);
export const revokeShareLink = (...a) => impl().revokeShareLink(...a);
export const openSharedReport = (...a) => impl().openSharedReport(...a);
export const existingTitles = (...a) => impl().existingTitles(...a);
export const importCompanies = (...a) => impl().importCompanies(...a);
export const runFreeAudit = (...a) => primary.runFreeAudit(...a);
export const sendFreeAudit = (...a) => primary.sendFreeAudit(...a);
export const getFreeAuditResult = (...a) => primary.getFreeAuditResult(...a);
export const freeAuditByEmail = (...a) => primary.freeAuditByEmail(...a);
export const getAuditLog = (...a) => impl().getAuditLog(...a);
export const recordExport = (...a) => impl().recordExport(...a);
export const resetDemo = (...a) => impl().resetDemo(...a);
export const getBilling = (...a) => impl().getBilling(...a);
export const startCheckout = (...a) => impl().startCheckout(...a);
export const openBillingPortal = (...a) => impl().openBillingPortal(...a);
export const exportOrgData = (...a) => impl().exportOrgData(...a);
export const deleteOrganisation = (...a) => impl().deleteOrganisation(...a);
export const deleteAccount = (...a) => impl().deleteAccount(...a);
export const getMfaStatus = (...a) => impl().getMfaStatus(...a);
export const startMfaSetup = (...a) => impl().startMfaSetup(...a);
export const confirmMfaSetup = (...a) => impl().confirmMfaSetup(...a);
export const verifyMfa = (...a) => impl().verifyMfa(...a);
export const disableMfa = (...a) => impl().disableMfa(...a);
export const signOutEverywhere = (...a) => impl().signOutEverywhere(...a);
export const getTracking = (...a) => impl().getTracking(...a);
export const setTracking = (...a) => impl().setTracking(...a);
export const requestFounderUpdate = (...a) => impl().requestFounderUpdate(...a);
export const enterMetrics = (...a) => impl().enterMetrics(...a);
export const confirmMetrics = (...a) => impl().confirmMetrics(...a);
// The founder update page is public: it always talks to the real backend.
export const getMetricRequest = (...a) => primary.getMetricRequest(...a);
export const submitMetricRequest = (...a) => primary.submitMetricRequest(...a);
export const getReviewQueue = (...a) => primary.getReviewQueue(...a);
export const reviewMetrics = (...a) => primary.reviewMetrics(...a);
