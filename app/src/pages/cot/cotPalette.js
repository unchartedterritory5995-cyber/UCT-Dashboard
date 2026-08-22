// app/src/pages/cot/cotPalette.js — the COT series palette, ONE authority for
// the chart panes and the positioning rail.
//
// Validated on the dark chart surface #14160f (dataviz validator, 2026-07-02):
// CVD ΔE 21.8, contrast ≥3:1. Deliberately breaks from the red/blue/yellow COT
// convention so the tab does not echo any one person's chart.

export const SERIES_COLORS = {
  commercials:  '#2d8c4e',   // UCT green — the hedgers
  largeSpecs:   '#b18c33',   // UCT gold — institutional trend money
  smallSpecs:   '#4a90c2',   // steel blue — the crowd
  openInterest: '#d4c9a8',   // UCT cream — OI strip
}

// Brightened variants for the hover-synced active bar in each pane.
export const HOVER_COLORS = {
  commercials: '#41b06d',
  largeSpecs:  '#d1a94a',
  smallSpecs:  '#6cb0e0',
}
