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
