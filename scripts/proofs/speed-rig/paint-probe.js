// THE FRAME-COMPLETE STAMP (2026-11-21, after the independent review and its validation): the owner's bar is "both
// linked charts' new candles within 40 ms of the key", read as FRAME-COMPLETE: the frame containing both charts'
// new pixels is finished by the renderer (its rAF callbacks, style, layout, paint and commit done). The ~33 ms the
// browser, GPU and vsync then take to put that frame on glass is constant, outside app code, and reported apart
// (pipeline_ms, from a trace: pixels-trace-check.mjs); the owner's historical 20-40 ms numbers were frame-based.
//
// Injected at document start (before any app script), so the library's own scheduling goes through it:
// lightweight-charts 5.2 paints in `window.requestAnimationFrame` (ChartWidget's invalidate handler). Every rAF
// callback is wrapped; a callback that DRAWS into a canvas inside a flip-proof chart widget is a PAINT of that
// chart. From inside that callback, AFTER its draw calls, a message is posted on a fresh MessageChannel: a task
// that can only run once the current rendering update (all of this frame's callbacks, then style, layout, paint
// and the commit) has finished. Its performance.now() is the paint's `complete`: never earlier than that chart's
// own draws (validation 1, 2026-11-21: the next rAF's TIMESTAMP was, when a frame overran, earlier than the second
// chart's draw). pixels(chart) = complete of its first paint of the new symbol; pixels_both = the last chart's.
//
// ⛔ THE PROBE READS NOTHING PER FRAME (a per-frame read that cloned series options cost ~3.8 ms a flip). Per paint
// it keeps the frame time, the callback's end, a count of draw calls and `complete`. Only while the proof has ARMED
// a switch (P.armed: each linked chart's newest bar at the key) and a chart's first new paint is not yet found does
// a paint of THAT chart read its newest bar (one by-index lookup, no series copy, no options); the first paint whose
// bar differs is marked `first`. With `marks = true` (the proof's --trace flips) each paint and completion also
// leaves a user-timing mark, so the stamp can be checked against the trace's commit of that frame.
;(() => {
  if (window.top !== window || window.__paintProbe) return
  const P = (window.__paintProbe = { paints: [], max: 30000, cur: null, lastCv: null, lastW: null, marks: false, onComplete: null, armed: null })
  const raf0 = window.requestAnimationFrame.bind(window)
  P.raf0 = raf0
  const wOf = new WeakMap()
  const widgetOf = (cv) => {
    if (!cv || !cv.closest) return null
    let w = wOf.get(cv)
    if (w === undefined) {
      const el = cv.closest('[data-widget-id]')
      w = el ? el.getAttribute('data-widget-id') : null
      if (w && !/^flip-chart/.test(w)) w = null
      wOf.set(cv, w)
    }
    return w
  }
  const proto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype
  if (proto) {
    for (const m of ['clearRect', 'fillRect', 'strokeRect', 'fill', 'stroke', 'drawImage', 'fillText', 'putImageData']) {
      const f = proto[m]
      if (typeof f !== 'function') continue
      proto[m] = function () {
        const cur = P.cur
        if (cur) {
          const cv = this.canvas
          if (cv !== P.lastCv) { P.lastCv = cv; P.lastW = widgetOf(cv) }
          if (P.lastW) cur.set(P.lastW, (cur.get(P.lastW) || 0) + 1)
        }
        return f.apply(this, arguments)
      }
    }
  }
  window.requestAnimationFrame = function (cb) {
    return raf0(function (t) {
      const s0 = performance.now()   // (cold-arch copy) the callback's start: paint cost = end - s
      const outer = P.cur
      P.cur = new Map()
      P.lastCv = null
      try { return cb(t) } finally {
        const drew = P.cur
        P.cur = outer
        P.lastCv = null
        if (drew.size) {
          const end = performance.now()
          const A = P.armed
          const ps = []
          for (const [w, draws] of drew) {
            const p = { w, t, s: s0, end, draws, complete: null }
            // the ONE read: an armed chart whose first paint of the new symbol has not been found yet
            if (A && A.need[w] && !A.found[w] && end >= A.key()) {
              try {
                const nb = window.__uctChartDebug[w].newestBar()
                if (nb) { p.time = nb.time; p.close = nb.close }
                if (nb && !(nb.time === A.need[w].time && nb.close === A.need[w].close)) { p.first = true; A.found[w] = p }
              } catch (e) { /* mid-remount */ }
            }
            if (P.paints.length < P.max) P.paints.push(p)
            if (P.marks) { try { performance.mark('__lwcPaint:' + w) } catch (e) { /* */ } }
            ps.push(p)
          }
          // the frame these draws belong to is complete when a task posted now gets to run
          try {
            const ch = new MessageChannel()
            ch.port1.onmessage = () => {
              const now = performance.now()
              ch.port1.close()
              for (const p of ps) {
                p.complete = now
                if (P.marks) { try { performance.mark('__frameDone:' + p.w) } catch (e) { /* */ } }
                if (P.onComplete) { try { P.onComplete(p) } catch (e) { /* the proof's hook */ } }
              }
            }
            ch.port2.postMessage(0)
          } catch (e) { /* no MessageChannel: no stamp, scored as not on screen */ }
        }
      }
    })
  }
})()
