// app/src/pages/research/themeInk.js
//
// A canvas (ECharts, Lightweight Charts) cannot resolve `var(--token)`: handed
// one, it silently drops the colour. So a chart colour has to be the token's
// RESOLVED value, read from <html>, where both [data-theme] and the app theme's
// inline overrides (styles/appThemes.js) land. The fallback is the dark-theme
// value from components/research-kit/charts/echartsCore.js's CHART_INK mirror,
// used only where no stylesheet is loaded (tests, a detached render).
//
// ⚠️ Read at render time: a chart drawn before a theme switch keeps the old ink
// until it next renders. No shared hook re-renders on a theme change today;
// noted for lane 1 as a missing shared helper.
export function themeInk(token, fallback) {
  try {
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
    const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    return v || fallback
  } catch {
    return fallback
  }
}
