// app/src/lib/theme/useThemeInk.js
//
// ⭐ THE HOOK THAT MAKES A CANVAS CHART FOLLOW THE MEMBER'S APP THEME.
//
// `resolveThemeColor` answers "what colour is this token right now". This hook
// answers it AGAIN whenever the theme changes, by re-rendering its caller.
//
// ⛔ WATCHING `data-theme` ALONE IS NOT ENOUGH. A catalog theme
// (styles/appThemes.js) is applied as `data-theme="oled"|"light"` PLUS its
// tokens as INLINE custom properties on <html>. Switching between two dark
// catalog themes changes only the inline `style` attribute; `data-theme` stays
// "oled". So one shared MutationObserver watches both attributes on <html>.
//
// ⛔ AND NOT EVERY `style` WRITE IS A THEME CHANGE. Other code sets inline
// style on <html> (scroll locks and the like). The observer bumps the version
// only when the THEME SIGNATURE moves — data-theme plus every inline custom
// property — so a modal opening does not re-render every chart on the page.
//
// One observer for the whole app, however many charts subscribe.

import { useMemo, useSyncExternalStore } from 'react'
import { resolveThemeInks } from './resolveThemeColor'

let version = 0
let lastSignature = null
let observer = null
const listeners = new Set()

function themeSignature() {
  if (typeof document === 'undefined' || !document.documentElement) return ''
  const el = document.documentElement
  const parts = [el.getAttribute('data-theme') || '']
  const st = el.style
  if (st) {
    for (let i = 0; i < st.length; i++) {
      const name = st[i]
      if (name && name.startsWith('--')) parts.push(`${name}:${st.getPropertyValue(name).trim()}`)
    }
  }
  return parts.join('|')
}

function onMutation() {
  const sig = themeSignature()
  if (sig === lastSignature) return
  lastSignature = sig
  version += 1
  for (const fn of [...listeners]) fn()
}

function ensureObserver() {
  if (observer || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
  const el = document.documentElement
  if (!el) return
  lastSignature = themeSignature()
  observer = new MutationObserver(onMutation)
  observer.observe(el, { attributes: true, attributeFilter: ['data-theme', 'style'] })
}

/** Subscribe to theme changes (attribute or catalog inline tokens). Returns an unsubscribe. */
export function subscribeTheme(fn) {
  ensureObserver()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && observer) {
      observer.disconnect()
      observer = null
    }
  }
}

/** Monotonic counter, bumped on every theme change. */
export function getThemeVersion() {
  return version
}

/**
 * Re-render the caller on a theme change; returns the current version. Use it
 * where a component computes its inks inline (e.g. through `themeInk`) and only
 * needs to be told to compute them again.
 */
export function useThemeVersion() {
  return useSyncExternalStore(subscribeTheme, getThemeVersion, getThemeVersion)
}

/**
 * Resolve a map of tokens to canvas-ready colours, re-resolved on every theme
 * change.
 *
 *   const ink = useThemeInk({
 *     gain: ['--gain', '#2faf68'],
 *     axis: ['--text-muted', '#cfcac0'],
 *     xs:   { size: '--text-xs', fallback: 10 },
 *   })
 *   // ink.gain → '#2faf68' (dark) / '#1c7a45' (light) …, ink.xs → 10 / 11 on a phone
 *
 * The spec may be a fresh literal every render: it is keyed by its contents.
 */
export function useThemeInk(spec) {
  const v = useThemeVersion()
  const key = JSON.stringify(spec ?? null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolveThemeInks(spec), [v, key])
}

/** Test seam: forget the shared observer so a test starts clean. */
export function __resetThemeObserverForTests() {
  if (observer) observer.disconnect()
  observer = null
  listeners.clear()
  lastSignature = null
}
