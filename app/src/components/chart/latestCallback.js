// app/src/components/chart/latestCallback.js — a stable function that calls the latest one handed to it.
//
// ⛔⛔ WHY NOT `useCallback` (2026-11-20): V8 points every closure a render creates at that render's ONE
// context, which holds every local any closure of that render captures (bars, filtered bars, the bar hook's
// callbacks and through them that render's snapshot, and every memoized callback, each holding the render
// IT was made in). A memoized callback kept across renders therefore keeps its render alive, and that
// render keeps older callbacks and their renders: two callbacks re-created in different renders (one keyed
// on the symbol, one on the settings) leapfrog into a chain that gains a link, and a symbol's whole data,
// per switch (StockChart.closureChains.test.jsx; production: ~30 MB per D + 60m switch).
//
// `useLatestCallback(fn)` returns ONE function for the component's life, made here, outside any render, so
// it points at nothing but its holder; the holder keeps only the newest `fn` (the current render). For
// EVENT-STYLE callbacks only: its identity never changes, so it must not stand in for a callback whose
// identity is a dependency that should re-run an effect or recompute a memo.
import { useState } from 'react'

function makeHolder() {
  let latest = null
  function call(...args) { return latest ? latest.apply(this, args) : undefined }
  return { call, set(fn) { latest = fn } }
}

/** One stable function for the component's life; each render hands it the newest implementation. */
export function useLatestCallback(fn) {
  const [h] = useState(makeHolder)
  h.set(fn)
  return h.call
}

// ─── the render's heavy values, read at use time ─────────────────────────────────────────────────────────
// ⛔⛔ (2026-11-20) A big component's closures must not CAPTURE its large locals (the bars arrays): V8 keeps
// a captured local in the render's shared context, and any closure kept across renders keeps that context
// and, through the memoized callbacks it holds, older renders' contexts (StockChart.closureChains.test.jsx:
// every link of such a chain carried that render's bars). `useRenderBox()` is ONE object for the
// component's life, made out here (it points at nothing of a render); each render `put`s its newest values
// and closures read `box.name` when they run. A closure therefore sees the NEWEST value, which for an effect
// body, a handler or a memo factory is its own render's (React flushes effects before the next render).
function makeBox() {
  const box = { put(name, value) { box[name] = value; return value } }
  return box
}

/** One object for the component's life holding the newest value of each heavy local (`put` each render). */
export function useRenderBox() {
  const [b] = useState(makeBox)
  return b
}
