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
import { useInsertionEffect, useState } from 'react'

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
// and closures read `box.name` when they run.
//
// ⛔⛔ TWO READS, BY WHEN THE CLOSURE RUNS (2026-11-20, the #2307 review). `box.name` is the NEWEST render's
// value, and a render can be ABANDONED after its `put`s: an interrupted transition (Watchlists' startTransition
// over memo(StockChart), a quick down-then-up) renders B, never commits it, and the committed chart still shows A.
//   • code that runs DURING a render (the body, a memo factory, a function the body calls) reads `box.name`:
//     the render in progress;
//   • code that runs AFTER a commit (a handler, a subscription, a timer, a paint function, `updateChart`) reads
//     `box.committed.name`: the values of the last render React COMMITTED. Read `box.name` there and an
//     abandoned render's bars are indexed by a chart that shows another symbol.
// An effect body may read either: React flushes a render's effects before it starts the next one, so at
// effect time the two agree.
// `commit` runs in an INSERTION effect (no deps, every committed render): insertion effects run before EVERY
// layout effect of the commit, children's included, so no layout effect or ref callback can read a stale copy.
const BOX_OWN = new Set(['put', 'commit', 'committed'])
function makeBox() {
  const committed = {}
  const box = {
    put(name, value) { box[name] = value; return value },
    committed,
    commit() { for (const k of Object.keys(box)) if (!BOX_OWN.has(k)) committed[k] = box[k] },
  }
  return box
}

/** One object for the component's life holding the newest value of each heavy local (`put` each render),
 *  and in `.committed` the values of the last committed render (copied in an insertion effect). */
export function useRenderBox() {
  const [b] = useState(makeBox)
  useInsertionEffect(() => { b.commit() })
  return b
}
