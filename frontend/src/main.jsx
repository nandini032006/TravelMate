import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// Polyfill Array.prototype.at for Android WebViews older than Chrome 92
if (!Array.prototype.at) {
  Array.prototype.at = function (n) {
    n = Math.trunc(n) || 0
    if (n < 0) n += this.length
    return n < 0 || n >= this.length ? undefined : this[n]
  }
}

// Polyfill Object.hasOwn for Android WebViews older than Chrome 93
if (!Object.hasOwn) {
  Object.hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)
}

// Set --actual-height CSS variable for Android WebView full-screen support.
// Android WebView doesn't support dvh reliably — use window.innerHeight instead.
function setViewportHeight() {
  document.documentElement.style.setProperty('--actual-height', `${window.innerHeight}px`)
}
setViewportHeight()
window.addEventListener('resize', setViewportHeight)
window.addEventListener('orientationchange', () => setTimeout(setViewportHeight, 200))

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
