// app/src/pages/research/themeInk.js
//
// A thin wrapper over the app's ONE canvas-colour resolver
// (`lib/theme/resolveThemeColor.js`), kept so the research tabs that import
// `themeInk` need no edits. The fallback is the dark-theme value from
// components/research-kit/charts/echartsCore.js's CHART_INK mirror, used only
// where no stylesheet is loaded (tests, a detached render).
//
// ⭐ Re-render on a theme change comes from `useThemeVersion()` in
// `ResearchPage.jsx`: the tabs are plain (un-memoised) children, so the page
// re-rendering on a theme change re-runs every `themeInk(...)` call below it.
// A component that renders a research chart OUTSIDE ResearchPage should call
// `useThemeVersion()` itself (re-exported here).
import { resolveThemeColor } from '../../lib/theme/resolveThemeColor'

export { useThemeVersion } from '../../lib/theme/useThemeInk'

export function themeInk(token, fallback) {
  return resolveThemeColor(token, fallback)
}
