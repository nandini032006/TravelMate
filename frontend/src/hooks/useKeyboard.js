import { useState, useEffect } from 'react'

/**
 * Detects software keyboard open/close via the visualViewport API.
 * Also keeps a --actual-height CSS custom property in sync with the real
 * visible height (window height minus keyboard), which CSS can use instead
 * of the unreliable 100vh / 100dvh on Android WebViews.
 */
export function useKeyboard() {
  const [isOpen, setIsOpen] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    function sync() {
      const windowH   = window.innerHeight
      const viewportH = window.visualViewport?.height ?? windowH
      const diff      = windowH - viewportH

      // A diff > 150px reliably indicates the software keyboard is open.
      const open = diff > 150
      setIsOpen(open)
      setKeyboardHeight(open ? diff : 0)

      // Keep a CSS variable accurate so layout can respond without JS re-renders.
      document.documentElement.style.setProperty('--actual-height', `${viewportH}px`)
    }

    sync() // set initial value

    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', sync)
      vv.addEventListener('scroll', sync)
      return () => {
        vv.removeEventListener('resize', sync)
        vv.removeEventListener('scroll', sync)
      }
    }

    // Fallback for browsers without visualViewport
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return { isOpen, keyboardHeight }
}
