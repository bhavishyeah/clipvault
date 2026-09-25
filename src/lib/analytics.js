// VOLT — Lightweight anonymous analytics
// Tracks usage patterns locally. No external service, no PII.

const STORAGE_KEY = 'volt-analytics'

function getStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : createStore()
  } catch {
    return createStore()
  }
}

function createStore() {
  return {
    sessionStart: Date.now(),
    totalSaves: 0,
    textSaves: 0,
    linkSaves: 0,
    imageSaves: 0,
    totalDeletes: 0,
    totalCopies: 0,
    totalEdits: 0,
    searches: 0,
    sessions: 0,
    lastActive: Date.now(),
  }
}

function persist(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage full or blocked — ignore
  }
}

export function trackEvent(event) {
  const store = getStore()
  store.lastActive = Date.now()

  switch (event) {
    case 'save_text': store.totalSaves++; store.textSaves++; break
    case 'save_link': store.totalSaves++; store.linkSaves++; break
    case 'save_image': store.totalSaves++; store.imageSaves++; break
    case 'delete': store.totalDeletes++; break
    case 'copy': store.totalCopies++; break
    case 'edit': store.totalEdits++; break
    case 'search': store.searches++; break
    case 'session_start': store.sessions++; break
    default: break
  }

  persist(store)
}

export function getAnalytics() {
  return getStore()
}

export function resetAnalytics() {
  localStorage.removeItem(STORAGE_KEY)
}

// --- Usage insights (Requirement 7) ---------------------------------------
//
// DECISION for Requirement 7.3 (documented, not silently misrepresented):
// The local store in `lib/analytics.js` keeps only LIFETIME counters
// (totalSaves, per-type saves, copies, deletes, searches, sessions) and retains
// NO per-event timestamps/history. A genuine rolling "this week" window would
// require per-event history we do not persist. Rather than fabricate a weekly
// figure from lifetime counters, insights are scoped to LIFETIME TOTALS.
//
// The returned view model therefore reports `window: 'lifetime'` so the UI can
// label the view honestly (e.g. "your vault so far" rather than "this week").
// If a real weekly window is wanted later, add a bounded local rolling history
// in its own design and switch `window` accordingly — no PII, local-only
// (Requirement 7.4).

// Below this total activity threshold there is not enough signal to present as
// insight, so callers should show a friendly low-data state (Requirement 7.5).
export const LOW_DATA_THRESHOLD = 5

/**
 * Shape the local counters into a view model for the insights view.
 *
 * Pure with respect to its input: pass a store (defaults to the persisted one)
 * and it returns a plain, PII-free object. Never throws on a missing/partial
 * store — absent counters are treated as 0.
 *
 * @param {object} [store] Optional counters object (defaults to persisted store).
 * @returns {{
 *   window: 'lifetime',
 *   totalSaves: number,
 *   saves: { text: number, link: number, image: number },
 *   copies: number,
 *   deletes: number,
 *   edits: number,
 *   searches: number,
 *   sessions: number,
 *   totalActivity: number,
 *   lowData: boolean,
 * }}
 */
export function getInsights(store = getStore()) {
  const s = store && typeof store === 'object' ? store : {}
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

  const saves = {
    text: n(s.textSaves),
    link: n(s.linkSaves),
    image: n(s.imageSaves),
  }
  const totalSaves = n(s.totalSaves)
  const copies = n(s.totalCopies)
  const deletes = n(s.totalDeletes)
  const edits = n(s.totalEdits)
  const searches = n(s.searches)
  const sessions = n(s.sessions)

  // Total meaningful activity used to decide whether we have enough signal.
  // Sessions alone are not "insightful" activity, so they are excluded here.
  const totalActivity = totalSaves + copies + deletes + edits + searches

  return {
    window: 'lifetime',
    totalSaves,
    saves,
    copies,
    deletes,
    edits,
    searches,
    sessions,
    totalActivity,
    lowData: totalActivity < LOW_DATA_THRESHOLD,
  }
}
