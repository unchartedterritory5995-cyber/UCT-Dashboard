// ⭐⭐ THE CHART MUST NOT ACT ON A KEY WHILE A DIALOG IS OPEN.
//
// ⚰️ THE BUG THIS EXISTS FOR, MEASURED IN PRODUCTION 2026-08-10: with the
// New-formula builder open, text typed at the dialog landed in the CHART'S TICKER
// BOX. A screenshot caught the builder rendered on top and `SMA(CLOSE,` sitting in
// the symbol search behind it.
//
// ⛔ AND THE DIALOG'S OWN FOCUS TRAP CANNOT FIX IT, which is why the guard lives
// on the chart side. `StockChart`'s shortcut listener is on `document` — it fires
// wherever focus is — and `SymbolSearch` deliberately hands focus BACK to the
// chart pane when its dropdown closes. Both were guarding on "is the target an
// input?", and a dialog is full of buttons, labels and panels that are none of
// INPUT/TEXTAREA/SELECT.
//
// This file pins the helper. The two CALL SITES are pinned by an AST check below,
// because a helper nobody calls is the shape of every feature this repo has
// shipped green and unreachable.

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isModalOpen } from './modalOpen.js'
import { stripComments } from '../components/chart/engine/__tests__/sourceScan'

afterEach(() => { document.body.innerHTML = '' })

describe('isModalOpen', () => {
  it('is false on a bare page — the control', () => {
    // ⛔ Without this, a helper hard-wired to `true` would pass every case below
    // and silently kill every chart hotkey in the product.
    expect(isModalOpen()).toBe(false)
    expect(isModalOpen(document.body)).toBe(false)
  })

  it('sees each spelling a dialog in this app can use', () => {
    for (const html of [
      '<div role="dialog">x</div>',
      '<div aria-modal="true">x</div>',
      '<dialog open>x</dialog>',
    ]) {
      document.body.innerHTML = html
      expect(isModalOpen(), html).toBe(true)
      document.body.innerHTML = ''
    }
  })

  it('is true for a target INSIDE a dialog', () => {
    document.body.innerHTML = '<div role="dialog"><button id="b">go</button></div>'
    expect(isModalOpen(document.getElementById('b'))).toBe(true)
  })

  it('🔴 is true for a target OUTSIDE the dialog while one is open', () => {
    // ⭐ THE ACTUAL BUG SHAPE. The chart pane is outside the dialog and still had
    // focus, so the event target was the chart — not the dialog. A guard that only
    // asked "is the target inside a dialog?" would have missed the whole thing.
    document.body.innerHTML = '<div id="chart" tabindex="0"></div><div role="dialog">x</div>'
    expect(isModalOpen(document.getElementById('chart'))).toBe(true)
  })

  it('goes back to false when the dialog closes', () => {
    document.body.innerHTML = '<div role="dialog">x</div>'
    expect(isModalOpen()).toBe(true)
    document.body.innerHTML = ''
    expect(isModalOpen()).toBe(false)
  })
})

describe('🔴 every chart key handler actually CONSULTS it', () => {
  // ⛔ DERIVED FROM THE SOURCE, not asserted about behaviour in a mock. A unit
  // test of the helper stays green while the guard is deleted from either call
  // site — which is exactly how this bug shipped in the first place.
  const read = (rel) =>
    fs.readFileSync(path.resolve(process.cwd(), 'src', rel), 'utf8')

  const SITES = {
    'components/StockChart.jsx': 'the document-level shortcut listener',
    'components/chart/pane/ChartPane.jsx': 'the pane type-to-search handler',
    // ⚰️ ADDED 2026-08-14 — the third one, found by MEASUREMENT and not by this
    // list. With the MACD settings dialog open on production and focus on its
    // panel, typing `t` armed the Trendline tool and `AAPL` armed the Pitchfork:
    // the overlay binds `window` keydown and was still testing only
    // INPUT/TEXTAREA. The 2026-08-10 fix enumerated two sites BY HAND and the
    // hand-written list is what missed this — hence the derived census below.
    'components/chart/ChartDrawingOverlay.jsx': 'the window-level drawing-tool shortcuts',
  }

  for (const [rel, what] of Object.entries(SITES)) {
    it(`${rel} imports and calls it — ${what}`, () => {
      const src = read(rel)
      expect(src, `${rel} lost the import`).toMatch(/import\s+isModalOpen\s+from/)
      expect(src, `${rel} imports it and never calls it`)
        .toMatch(/if\s*\(\s*isModalOpen\s*\(/)
    })
  }

  it('⛔ THE CONTROL — the probe can tell a file that does NOT call it', () => {
    // Without this, the assertions above would pass on a regex that matched
    // anything at all.
    const src = read('utils/modalOpen.js')
    expect(/import\s+isModalOpen\s+from/.test(src)).toBe(false)
  })

  // ─── THE CENSUS ───────────────────────────────────────────────────────────
  //
  // ⭐ THE LIST IS DERIVED, NOT TYPED. A hand-written roster of call sites is
  // what let `ChartDrawingOverlay` keep leaking for four days after the guard
  // shipped, so this walks the chart tree, finds every file that registers a
  // `window`/`document` keydown listener, and requires each one to be classified.
  // A new global handler added tomorrow fails HERE, by name, until someone
  // decides which kind it is.
  const GLOBAL_KEYDOWN = /(?:window|document)\.addEventListener\(\s*['"]keydown['"]/

  /** Handlers that BELONG to the surface that renders them — a dialog's own
   *  Escape, a popover's own arrow keys. These must keep firing while that
   *  surface is open, so consulting `isModalOpen` would break them. */
  const MODAL_OWNED = {
    'components/chart/ChartContextMenu.jsx': "the context menu's own Escape",
    'components/chart/ChartSettingsModal.jsx': "the settings modal's own Escape",
    'components/chart/ChartThemesModal.jsx': "the themes gallery's own Escape",
    'components/chart/EarningsMarkerPopover.jsx': "the popover's own dismissal",
    // ⭐ SAME CLASS AS THE POPOVER ABOVE, AND VERIFIED RATHER THAN ASSUMED: its
    // effect opens with `if (!open) return`, so the listener EXISTS only while
    // its own panel does, and all it does is close that panel. It cannot reach a
    // keystroke meant for anything else. (Classified 2026-08-29 — it arrived with
    // the Drawing Boards ship at `b9c86d55a` and this rail caught it, which is
    // exactly the rail working: a new global keydown must be reasoned about, not
    // waved through.)
    'components/chart/BoardsToolButton.jsx':
      "the boards popover's own Escape, registered only while it is open",
    'components/chart/KeyboardHelpOverlay.jsx': "the shortcut sheet's own Escape",
    'components/chart/SymbolSearch.jsx': "the ticker box's own dropdown navigation",
    'components/chart/PatternSidePanel.jsx': "the side panel's own Escape",
    // ⭐ NARROWER THAN `isModalOpen`, NOT LOOSER. This one claims Escape only
    // while a completion popup is open AND `view.dom.contains(e.target)` — so it
    // can only ever answer for keystrokes already inside its own editor, which is
    // itself inside the builder sheet. It runs at WINDOW capture because
    // `mobile/Sheet.jsx` answers Escape at DOCUMENT capture and would otherwise
    // close the sheet out from under an open popup; consulting `isModalOpen` here
    // would be backwards (a dialog IS open — this editor's).
    'components/chart/builder/editor/CodeEditor.jsx':
      "the formula editor's own Escape, claimed only while its completion popup is open",
  }

  /** Listeners that only READ A KEY'S TIMING to schedule work, and never change what
   *  the key does. The rail exists to keep the chart from ACTING on a key typed at a
   *  dialog; these do not act on keys at all, so `isModalOpen` would buy nothing there
   *  and would change only WHEN their work leaves (a perf regression, not a guard).
   *  ⛔ NOT TAKEN ON TRUST: each entry must pass `readsKeyTimingOnly` below, which reads
   *  the code (never the prose) and fails a listener that is not passive (so it could
   *  cancel the key), anything that stops or cancels an event, and a component (which
   *  could draw, arm a tool or type into a box). (Classified 2026-11-17: serverCompute
   *  arrived with 67ba803940 and this rail caught it.) */
  const TIMING_OBSERVERS = {
    'components/chart/engine/serverCompute.js':
      "the RS lane's walk-key cadence: a held ArrowUp/ArrowDown's release sends the landing "
      + "chart's held ask now, instead of when its hold (500 ms at most) would have sent it",
  }

  // Every key listener a file registers, on any target, whatever the handler's shape.
  const ANY_KEY_LISTENER = /\.addEventListener\(\s*['"]key(?:down|up|press)['"]/g
  // The one shape the observer check accepts: a named handler and an options object that
  // says `passive: true`. A listener in any other shape (an inline arrow, no options, an
  // options variable the probe cannot read) is counted above and not here, and fails.
  const PASSIVE_KEY_LISTENER =
    /\.addEventListener\(\s*['"]key(?:down|up|press)['"]\s*,\s*[\w$.]+\s*,\s*\{[^{}]*\bpassive\s*:\s*true\b[^{}]*\}\s*\)/g

  /** Does this SOURCE only read key timing? Code, never prose: the comments are stripped. */
  function readsKeyTimingOnly(src) {
    const code = stripComments(src)
    const all = (code.match(ANY_KEY_LISTENER) || []).length
    if (!all) return { ok: false, why: 'registers no key listener' }
    const passive = (code.match(PASSIVE_KEY_LISTENER) || []).length
    if (passive !== all) return { ok: false, why: `${all - passive} of ${all} key listener(s) not provably passive` }
    if (/\.(?:preventDefault|stopPropagation|stopImmediatePropagation)\s*\(/.test(code)) {
      return { ok: false, why: 'cancels or stops an event' }
    }
    if (/\bfrom\s+['"]react(?:-dom)?(?:\/[\w-]+)?['"]/.test(code)) return { ok: false, why: 'is a component' }
    return { ok: true, why: '' }
  }

  for (const [rel, what] of Object.entries(TIMING_OBSERVERS)) {
    it(`${rel} only reads key timing — ${what}`, () => {
      const v = readsKeyTimingOnly(read(rel))
      expect(v.ok, `${rel}: ${v.why}`).toBe(true)
      // A stale entry would wave through whatever the file grows next.
      expect(chartFilesWithAGlobalKeydown(), `${rel} no longer registers a global keydown`).toContain(rel)
    })
  }

  it('⛔ THE CONTROL — the observer check catches a real handler, clause by clause', () => {
    // Real key handlers in this tree: each ACTS on keys, and the check must say so.
    for (const rel of ['components/chart/ChartDrawingOverlay.jsx', 'components/StockChart.jsx']) {
      expect(readsKeyTimingOnly(read(rel)).ok, `${rel} passed as a timing observer`).toBe(false)
    }
    // Each clause can fire on its own, and the prose cannot satisfy or trip it.
    const ok = "const f = (e) => { last = e.key }\nwindow.addEventListener('keydown', f, { capture: true, passive: true })\n"
    expect(readsKeyTimingOnly(ok).ok).toBe(true)
    expect(readsKeyTimingOnly(ok + '// e.preventDefault() is never called here\n').ok).toBe(true)
    expect(readsKeyTimingOnly(ok.replace('passive: true', 'passive: false')).ok).toBe(false)
    expect(readsKeyTimingOnly(ok + "window.addEventListener('keyup', (e) => { last = e.key })\n").ok).toBe(false)
    expect(readsKeyTimingOnly(ok.replace('last = e.key', 'e.stopPropagation()')).ok).toBe(false)
    expect(readsKeyTimingOnly("import { useEffect } from 'react'\n" + ok).ok).toBe(false)
    expect(readsKeyTimingOnly('const nothing = 1\n').ok).toBe(false)
  })

  function chartFilesWithAGlobalKeydown() {
    const root = path.resolve(process.cwd(), 'src')
    const out = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(jsx|js)$/.test(entry.name)) continue
        if (/\.test\.(jsx|js)$/.test(entry.name)) continue
        if (!GLOBAL_KEYDOWN.test(fs.readFileSync(full, 'utf8'))) continue
        out.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
    walk(path.join(root, 'components', 'chart'))
    const stockChart = path.join(root, 'components', 'StockChart.jsx')
    if (GLOBAL_KEYDOWN.test(fs.readFileSync(stockChart, 'utf8'))) out.push('components/StockChart.jsx')
    return out.sort()
  }

  it('the census finds the handlers it exists to police — the control', () => {
    // Without this, a walker that silently found nothing would pass the
    // classification assertion below on an empty set.
    const found = chartFilesWithAGlobalKeydown()
    expect(found.length).toBeGreaterThan(4)
    expect(found).toContain('components/chart/ChartDrawingOverlay.jsx')
    expect(found).toContain('components/StockChart.jsx')
  })

  it('🔴 every chart file with a global keydown is guarded, modal-owned, or a timing observer', () => {
    const unclassified = chartFilesWithAGlobalKeydown()
      .filter(rel => !(rel in SITES) && !(rel in MODAL_OWNED) && !(rel in TIMING_OBSERVERS))
    expect(unclassified, 'a chart key handler nobody has classified — it either has to '
      + 'consult isModalOpen (add it to SITES), belong to the surface that renders it '
      + '(add it to MODAL_OWNED, with the reason), or only read the key\'s timing (add it '
      + 'to TIMING_OBSERVERS, with the reason; readsKeyTimingOnly must pass)').toEqual([])
  })
})
