import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { isTauri } from './utils/platform'
import './styles.css'

if (!isTauri()) registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
