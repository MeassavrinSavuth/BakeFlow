import { createContext, useState, useEffect } from 'react'

export const LanguageContext = createContext({
  lang: 'en',
  setLang: () => { },
})

const STORAGE_KEY = 'bf_ui_lang'

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState('en')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'en' || stored === 'my') {
        setLang(stored)
      }
    } catch (e) {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch (e) {
      // ignore
    }
  }, [lang, mounted])

  return (
    <LanguageContext.Provider value={{ lang, setLang, mounted }}>
      {children}
    </LanguageContext.Provider>
  )
}
