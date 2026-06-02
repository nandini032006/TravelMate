import { createContext, useContext, useState } from 'react'
import { en } from '../translations/en'
import { te } from '../translations/te'

const TRANSLATIONS = { en, te }

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const saved = localStorage.getItem('tm_lang') || 'en'
  const [lang, setLang] = useState(saved)

  function toggleLang() {
    const next = lang === 'en' ? 'te' : 'en'
    setLang(next)
    localStorage.setItem('tm_lang', next)
  }

  const t = TRANSLATIONS[lang]

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLang() {
  return useContext(LanguageContext)
}
