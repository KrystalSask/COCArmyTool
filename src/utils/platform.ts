declare global {
  interface Window { __TAURI_INTERNALS__?: unknown }
}

export const isTauri = () => typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
