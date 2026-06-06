// Canvas-rendered charts (ECharts, Chart.js) can't read CSS variables, so they
// need the font stack as a literal. Keep this mirrored with --font-sans in
// app/src/styles/tokens.css so chart text matches the rest of the UI.
// (SVG-based Recharts is handled via a global .recharts-text CSS rule instead.)
export const CHART_FONT_FAMILY =
  "'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif"
