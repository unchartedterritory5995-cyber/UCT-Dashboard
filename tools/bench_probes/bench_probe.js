/*
 * UCT head-to-head benchmark probe -- ONE instrument for Notion, Evernote, Obsidian and UCT.
 * Wave 9, lane 9A, item A2. docs/notebook/benchmark/protocol.md says when to run each line.
 *
 * Self-contained: no imports, no build step. The owner pastes this whole file into a DevTools
 * console; tools/notebook_bench_uct.py evaluates the SAME bytes (Playwright add_init_script).
 * It installs window.__uctBench:
 *
 *   await __uctBench.selfTest()        // R-HON: must print PASS before anything is timed
 *   __uctBench.check(marker)           // true/false: is this text in the page right now? (has() is silent)
 *   __uctBench.arm('open',   {marker, mode: 'first'|'full', anchor, reps, timeoutMs})
 *   __uctBench.arm('search', {expectedTitle, reps, timeoutMs})
 *   __uctBench.arm('typing', {expectKeys})
 *   __uctBench.arm('paste',  {endMarker, reps, timeoutMs})
 *   await __uctBench.arm('cold')       // the buffered largest-contentful-paint -- an LCP PROXY
 *   __uctBench.status()                // {kind, state, attempts, samples, invalid, ignored}
 *   copy(__uctBench.dump('notion', 'H4'))   // copy() is the Chrome/Electron console utility
 *
 * What each op times (every clock is performance.now(); a MutationObserver callback is where a
 * sample ends -- the end of the task that inserted the content, before paint):
 *   open    t0 = the pointerdown (capture phase) or Enter keydown that opens the target, made
 *           while the target is NOT displayed. It ends when a node added after t0 contains
 *           `marker`: 'first' also needs it to intersect the viewport, 'full' only connected.
 *           Gestures made WHILE the target is displayed are navigation away from it and never
 *           start a rep. With `anchor` (the note's FIRST marker, for 'full' mode), a gesture
 *           whose anchor never appears was navigation too (counted in `ignored`); a newer
 *           gesture before the anchor appears supersedes the older one.
 *   search  a rep starts at a typing keydown into an EMPTY text field (input, textarea or
 *           contenteditable); t0 is the LAST typing keydown before the result. It ends when a
 *           node added after the first keydown, outside the field being typed into, contains
 *           `expectedTitle` and is visible.
 *   typing  the perf harness's method (tools/notebook_perf_harness.py:159-184), generalised: a
 *           capture-phase keydown stamps t0; an `input` on any contenteditable/textarea posts a
 *           MessageChannel message after a microtask; its handler stamps t1. Fewer samples than
 *           `expectKeys` makes the dump INCONCLUSIVE -- never a p95 over the keys that landed.
 *   paste   a capture-phase `paste` stamps t0; it ends when a node added after t0 contains
 *           `endMarker` and is connected.
 *   cold    the buffered largest-contentful-paint entry after a reload. Labelled "LCP proxy"
 *           everywhere: a probe pasted after load cannot see navigation start any other way.
 * ⛔ If the marker is already in the page at a rep's t0, the rep is INVALID
 * ('marker-present-at-t0'), never 0 ms. A timeout is 'not-in-dom', never a number.
 *
 * selfTest() arms an open-measurement on its own hidden element, fires a synthetic pointerdown,
 * inserts the marker after setTimeout(200) and PASSES only inside [195, 260] ms. Every dump
 * carries the latest reading; tools/notebook_bench_report.py refuses a dump without a pass, and
 * refuses a dump whose probeVersion is not the constant below (a pasted old probe, by name).
 */
(() => {
  'use strict'
  const PROBE_VERSION = 'uct-bench-probe/1'
  const SELFTEST_DELAY_MS = 200
  const SELFTEST_WINDOW = [195, 260]
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA'])
  const SELFTEST_FLAG = '__uctBenchSelfTest'

  const prev = window.__uctBench
  if (prev && typeof prev._uninstall === 'function') prev._uninstall()

  // Test seams. Overriding any of them marks every later dump `hooks: true`, which the report
  // refuses: jsdom has no layout, so a test injects the viewport check, and a dump made that way
  // is never a measurement.
  const hooks = {
    now: () => performance.now(),
    isVisible: (el) => {
      const r = el.getBoundingClientRect()
      if (!r || (r.width === 0 && r.height === 0)) return false
      if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return false
      const cs = window.getComputedStyle(el)
      return cs.visibility !== 'hidden' && cs.display !== 'none'
    },
    readLcp: () => new Promise((resolve) => {
      if (typeof PerformanceObserver !== 'function') return resolve({ error: 'PerformanceObserver is not available' })
      const got = []
      let po
      try {
        po = new PerformanceObserver((list) => { got.push(...list.getEntries()) })
        po.observe({ type: 'largest-contentful-paint', buffered: true })
      } catch (e) {
        return resolve({ error: 'largest-contentful-paint is not observable here: ' + e })
      }
      setTimeout(() => {
        try { got.push(...po.takeRecords()) } catch (e) { /* older engines */ }
        po.disconnect()
        if (!got.length) return resolve({ error: 'no largest-contentful-paint entry was buffered' })
        const e = got[got.length - 1]
        const el = e.element
        resolve({ ms: e.renderTime || e.startTime || e.loadTime, size: e.size,
                  element: el ? (el.tagName + ' ' + String(el.textContent || '').trim().slice(0, 60)) : null })
      }, 60)
    }),
  }
  let hooked = false
  let session = null
  let lastSelfTest = null
  const internal = new Set()          // the selfTest's own session, never the member's
  const raf = (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16))

  // ── the page's text, excluding what a person cannot see as content ───────────────────────
  function skipped(node, exclude) {
    for (let n = node.parentNode; n; n = n.parentNode) {
      if (n.nodeType === 1 && SKIP_TAGS.has(n.tagName)) return true
      if (exclude && n === exclude) return true
    }
    return false
  }

  /** Is `text` in the page now? Text nodes are concatenated in document order, so a title split
   *  by a highlight (`<b>Vir</b>eo cobalt`) still counts; scripts, styles and the field being
   *  typed into do not. */
  function present(text, exclude) {
    const root = document.body || document.documentElement
    if (!root || !text) return false
    if (!String(root.textContent || '').includes(text)) return false
    const w = document.createTreeWalker(root, typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4)
    let acc = ''
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (skipped(n, exclude)) continue
      acc += n.data
    }
    return acc.includes(text)
  }

  /** The deepest element under `el` whose text still holds all of `text`. */
  function deepest(el, text) {
    let cur = el
    for (;;) {
      let next = null
      for (const c of cur.children || []) {
        if (String(c.textContent || '').includes(text)) { next = c; break }
      }
      if (!next) return cur
      cur = next
    }
  }

  /** Elements that received content in this batch: added elements, the parent of an added or
   *  changed text node. A candidate inside another candidate is dropped (the ancestor covers it). */
  function candidates(records) {
    const set = new Set()
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1) set.add(n)
          else if (n.nodeType === 3 && n.parentElement) set.add(n.parentElement)
        }
      } else if (r.type === 'characterData' && r.target.parentElement) {
        set.add(r.target.parentElement)
      }
    }
    const out = []
    for (const el of set) {
      let covered = false
      for (let p = el.parentElement; p; p = p.parentElement) { if (set.has(p)) { covered = true; break } }
      if (!covered) out.push(el)
    }
    return out
  }

  function fieldOf(target) {
    if (!target || target.nodeType !== 1) return null
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return target
    if (target.isContentEditable) {
      let host = target
      while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement
      return host
    }
    return null
  }
  function fieldEmpty(f) {
    if (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA') return String(f.value || '') === ''
    return String(f.textContent || '').trim() === ''
  }
  function typingKey(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false
    return typeof ev.key === 'string' && (ev.key.length === 1 || ev.key === 'Backspace' || ev.key === 'Delete')
  }
  const round3 = (x) => Math.round(x * 1000) / 1000

  // ── one session per arm() ─────────────────────────────────────────────────────────────────
  function makeSession(kind, opts, isInternal) {
    const s = {
      kind, internal: !!isInternal, state: 'ready', samples: [], invalid: [], attempts: 0, ignored: 0,
      reps: Math.max(1, Number(opts.reps) || (kind === 'cold' ? 1 : 20)),
      timeoutMs: Math.max(100, Number(opts.timeoutMs) || 10000),
      mode: kind === 'open' ? (opts.mode === 'full' ? 'full' : 'first') : undefined,
      marker: opts.marker || opts.endMarker || opts.expectedTitle || null,
      anchor: kind === 'open' ? (opts.anchor || opts.marker) : null,
      expectKeys: kind === 'typing' ? Math.max(1, Number(opts.expectKeys) || 60) : undefined,
      t0: null, lastKey: null, field: null, anchorSeen: false, timer: null, mo: null, waitEls: [],
      upAt: null, press: [],
      token: 0, pendingKey: null, done: null, label: kind === 'cold' ? 'LCP proxy' : undefined, lcp: null,
    }
    s.finished = new Promise((resolve) => { s.done = resolve })
    return s
  }

  function stopWatching(s) {
    if (s.mo) { s.mo.disconnect(); s.mo = null }
    if (s.timer) { clearTimeout(s.timer); s.timer = null }
    s.waitEls = []
  }

  function finishAttempt(s) {
    s.attempts += 1
    stopWatching(s)
    if (s.attempts >= s.reps) { s.state = 'done'; s.done(s); return }
    s.state = s.kind === 'open' ? 'clearing' : 'ready'
  }

  function recordSample(s, ms) {
    s.samples.push(round3(ms))
    // The press (pointerdown -> pointerup) rides beside an open sample: a hand click includes it
    // when the app opens on `click`, and would not when it opens on pointerdown. Shown, not hidden.
    if (s.kind === 'open') s.press.push(s.upAt == null ? null : round3(s.upAt - s.t0))
    finishAttempt(s)
  }

  function recordInvalid(s, reason) {
    s.invalid.push(reason)
    finishAttempt(s)
  }

  function startTimer(s) {
    if (s.timer) clearTimeout(s.timer)
    const token = ++s.token
    s.timer = setTimeout(() => {
      if (s.state !== 'pending' || token !== s.token) return
      if (s.kind === 'open' && s.anchor !== s.marker && !s.anchorSeen) {
        s.ignored += 1                       // the gesture opened something else: navigation
        stopWatching(s)
        s.state = 'clearing'
        return
      }
      recordInvalid(s, 'not-in-dom')
    }, s.timeoutMs)
  }

  function satisfied(s, el) {
    if (!el.isConnected) return false
    if (s.kind === 'open' && s.mode === 'full') return true
    if (s.kind === 'paste') return true
    return hooks.isVisible(el)
  }

  function onMutations(s, records) {
    if (s.state !== 'pending') return
    const now = hooks.now()
    const exclude = s.kind === 'search' ? s.field : null
    for (const el of candidates(records)) {
      if (exclude && (el === exclude || exclude.contains(el))) continue
      if (el.tagName && SKIP_TAGS.has(el.tagName)) continue
      const text = String(el.textContent || '')
      if (s.kind === 'open' && s.anchor !== s.marker && !s.anchorSeen && text.includes(s.anchor)) s.anchorSeen = true
      if (!text.includes(s.marker)) continue
      const host = deepest(el, s.marker)
      if (satisfied(s, host)) {
        const t0 = s.kind === 'search' ? s.lastKey : s.t0
        return recordSample(s, now - t0)
      }
      s.waitEls.push(host)
      pollVisible(s)
    }
  }

  function pollVisible(s) {
    const token = s.token
    raf(() => {
      if (s.state !== 'pending' || token !== s.token || !s.waitEls.length) return
      const hit = s.waitEls.find((el) => satisfied(s, el))
      if (hit) {
        const t0 = s.kind === 'search' ? s.lastKey : s.t0
        return recordSample(s, hooks.now() - t0)
      }
      pollVisible(s)
    })
  }

  function goPending(s, t) {
    s.state = 'pending'
    s.t0 = t
    s.upAt = null
    s.anchorSeen = false
    s.waitEls = []
    if (!s.mo) {
      s.mo = new MutationObserver((records) => onMutations(s, records))
      s.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    }
    startTimer(s)
  }

  // ── the gestures ───────────────────────────────────────────────────────────────────────────
  function sessionsFor(ev) {
    const all = []
    if (ev[SELFTEST_FLAG]) { for (const s of internal) all.push(s) } else if (session) all.push(session)
    return all.filter((s) => s.state !== 'done')
  }

  function onOpenGesture(s, t) {
    if (s.state === 'pending') {
      if (!s.anchorSeen) { s.t0 = t; s.upAt = null; startTimer(s) }   // a newer gesture before the target showed
      return
    }
    const shown = present(s.marker) || (s.anchor !== s.marker && present(s.anchor))
    if (s.state === 'clearing' && shown) return          // navigating away from the target
    if (shown) return recordInvalid(s, 'marker-present-at-t0')
    goPending(s, t)
  }

  function onPointerDown(ev) {
    const t = hooks.now()
    for (const s of sessionsFor(ev)) if (s.kind === 'open') onOpenGesture(s, t)
  }

  function onPointerUp(ev) {
    const t = hooks.now()
    for (const s of sessionsFor(ev)) if (s.kind === 'open' && s.state === 'pending' && s.upAt == null) s.upAt = t
  }

  function onKeyDown(ev) {
    const t = hooks.now()
    for (const s of sessionsFor(ev)) {
      if (s.kind === 'open') {
        if (ev.key === 'Enter') onOpenGesture(s, t)
      } else if (s.kind === 'typing') {
        s.pendingKey = t
      } else if (s.kind === 'search') {
        if (!typingKey(ev)) continue
        const f = fieldOf(ev.target)
        if (!f) continue
        if (s.state === 'pending') { if (f === s.field) { s.lastKey = t; startTimer(s) } continue }
        if (!fieldEmpty(f)) continue                      // a rep starts on a FRESH query only
        if (present(s.marker, f)) { recordInvalid(s, 'marker-present-at-t0'); continue }
        s.field = f
        s.lastKey = t
        goPending(s, t)
      }
    }
  }

  function onInput(ev) {
    const target = ev.target
    if (!target || !(target.isContentEditable || target.tagName === 'TEXTAREA')) return
    for (const s of sessionsFor(ev)) {
      if (s.kind !== 'typing' || s.pendingKey == null) continue
      const t0 = s.pendingKey
      s.pendingKey = null
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        ch.port1.close()
        if (s.state === 'done') return
        s.samples.push(round3(hooks.now() - t0))
        if (s.samples.length >= s.expectKeys) { s.state = 'done'; s.done(s) }
      }
      queueMicrotask(() => ch.port2.postMessage(0))
    }
  }

  function onPaste(ev) {
    const t = hooks.now()
    for (const s of sessionsFor(ev)) {
      if (s.kind !== 'paste' || s.state === 'pending') continue
      if (present(s.marker)) { recordInvalid(s, 'marker-present-at-t0'); continue }
      goPending(s, t)
    }
  }

  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('input', onInput, true)
  window.addEventListener('paste', onPaste, true)

  // ── the API ────────────────────────────────────────────────────────────────────────────────
  function arm(kind, opts = {}) {
    opts = opts || {}
    if (!['open', 'search', 'typing', 'paste', 'cold'].includes(kind)) throw new Error('unknown op kind: ' + kind)
    if (kind === 'open' && !opts.marker) throw new Error("arm('open') needs {marker}")
    if (kind === 'search' && !opts.expectedTitle) throw new Error("arm('search') needs {expectedTitle}")
    if (kind === 'paste' && !opts.endMarker) throw new Error("arm('paste') needs {endMarker}")
    if (session) stopWatching(session)
    const s = makeSession(kind, opts, false)
    session = s
    if (kind === 'cold') {
      return hooks.readLcp().then((r) => {
        if (r && typeof r.ms === 'number' && isFinite(r.ms)) { s.samples.push(round3(r.ms)); s.lcp = r } else s.invalid.push('no-lcp: ' + ((r && r.error) || 'unknown'))
        s.attempts = 1
        s.state = 'done'
        s.done(s)
        const msg = '[uctBench] cold (LCP proxy): ' + (s.samples.length ? s.samples[0] + ' ms' : s.invalid[0])
        console.log(msg)
        return msg
      })
    }
    const note = s.marker && kind !== 'typing' ? ('; target ' + (present(s.marker) ? 'PRESENT now' : 'absent now')) : ''
    const msg = '[uctBench] armed ' + kind + (s.mode ? ' (' + s.mode + ')' : '') +
      (kind === 'typing' ? ' for ' + s.expectKeys + ' keys' : ' for ' + s.reps + ' reps') + note
    console.log(msg)
    return msg
  }

  function check(text) {
    const p = present(text)
    console.log('[uctBench] ' + JSON.stringify(text) + ' is ' + (p ? 'PRESENT' : 'absent'))
    return p
  }

  function statusOf(s) {
    if (!s) return 'NOT ARMED'
    if (s.kind === 'typing') return s.samples.length >= s.expectKeys ? 'COMPLETE' : 'INCONCLUSIVE'
    return s.attempts >= s.reps ? 'COMPLETE' : 'INCOMPLETE'
  }

  function status() {
    const s = session
    return s ? { kind: s.kind, state: s.state, attempts: s.attempts, samples: s.samples.length,
                 invalid: s.invalid.length, ignored: s.ignored, status: statusOf(s) } : { kind: null, state: 'idle' }
  }

  function samples(kind) {
    const s = session
    if (!s || (kind && s.kind !== kind)) return []
    return s.samples.slice()
  }

  function dump(app, op) {
    const s = session
    const d = {
      probeVersion: PROBE_VERSION,
      app: String(app),
      op: String(op),
      kind: s ? s.kind : null,
      status: statusOf(s),
      mode: s ? s.mode : undefined,
      label: s ? s.label : undefined,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      capturedAt: new Date().toISOString(),
      samples: s ? s.samples.slice() : [],
      invalid: s ? s.invalid.slice() : [],
      selfTest: lastSelfTest,
      press: s && s.kind === 'open' ? s.press.slice() : undefined,
      reps: s && s.kind !== 'typing' ? s.reps : undefined,
      attempts: s ? s.attempts : 0,
      ignored: s ? s.ignored : 0,
      expectKeys: s ? s.expectKeys : undefined,
      target: s ? { marker: s.marker, anchor: s.anchor && s.anchor !== s.marker ? s.anchor : undefined } : undefined,
      lcp: s && s.lcp ? { size: s.lcp.size, element: s.lcp.element } : undefined,
    }
    if (hooked) d.hooks = true
    return JSON.stringify(d, null, 1)
  }

  async function selfTest() {
    const host = document.createElement('div')
    host.setAttribute('data-uct-bench-selftest', '')
    host.setAttribute('aria-hidden', 'true')
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden'
    ;(document.body || document.documentElement).appendChild(host)
    const marker = 'uctbenchselftest' + Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 8)
    const s = makeSession('open', { marker, mode: 'full', reps: 1, timeoutMs: 2000 }, true)
    internal.add(s)
    const Ev = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent
    const ev = new Ev('pointerdown', { bubbles: true, cancelable: true })
    ev[SELFTEST_FLAG] = true
    host.dispatchEvent(ev)
    setTimeout(() => { const p = document.createElement('p'); p.textContent = marker; host.appendChild(p) }, SELFTEST_DELAY_MS)
    await s.finished
    internal.delete(s)
    host.remove()
    const ms = s.samples.length ? s.samples[0] : null
    const ok = ms !== null && ms >= SELFTEST_WINDOW[0] && ms <= SELFTEST_WINDOW[1]
    lastSelfTest = { ok, ms, version: PROBE_VERSION, delayMs: SELFTEST_DELAY_MS, window: SELFTEST_WINDOW.slice(),
                     at: new Date().toISOString(), invalid: s.invalid.slice() }
    console.log('[uctBench] selfTest ' + (ok ? 'PASS' : 'FAIL') + ': ' + (ms === null ? s.invalid.join(',') : ms + ' ms') +
                ' (a ' + SELFTEST_DELAY_MS + ' ms insertion must read ' + SELFTEST_WINDOW.join('-') + ' ms)')
    return lastSelfTest
  }

  function setHooks(h) {
    for (const k of Object.keys(h || {})) if (typeof h[k] === 'function' && k in hooks) { hooks[k] = h[k]; hooked = true }
    return hooked
  }

  function disarm() { if (session) { stopWatching(session); session.state = 'done' } session = null }

  function _uninstall() {
    disarm()
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('input', onInput, true)
    window.removeEventListener('paste', onPaste, true)
  }

  window.__uctBench = Object.freeze({
    version: PROBE_VERSION, selfTest, arm, check, samples, status, dump, disarm, setHooks, _uninstall,
    has: (text) => present(text),          // check() without the console line, for a runner's poll
    finished: () => (session ? session.finished : Promise.resolve(null)),
  })
  console.log('[uctBench] ' + PROBE_VERSION + ' installed -- run: await __uctBench.selfTest()')
})()
