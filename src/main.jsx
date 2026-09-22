import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import ErrorBoundary from './components/ui/ErrorBoundary.jsx'

// Unregister any old Service Workers that have navigateFallback set.
// Those SWs intercept file-picker focus-returns, tab switches, and popup
// closes on Android Chrome, causing the page to reload unexpectedly.
// The new SW (without navigateFallback) will be registered fresh after
// existing SWs are cleared.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((reg) => reg.unregister())
  })
}

registerSW({
  immediate: false,
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
