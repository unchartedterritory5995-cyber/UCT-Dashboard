// Rails for tools/bench_probes/bench_probe.js -- the head-to-head benchmark probe (wave 9, 9A, A2).
//
// The probe is ONE file the owner pastes into four apps' DevTools and the UCT runner evaluates
// unchanged, so these rails read that file from disk and evaluate it in the jsdom window exactly
// as a console would, then drive each op with synthetic events and DOM insertions.
//
// ⛔ jsdom proves the LOGIC only. It has no layout (the viewport check is injected through
// setHooks, and a hooked dump is marked so the report refuses it) and no real engine timing. The
// real-engine proof is the runner's selfTest in Chromium (tools/notebook_bench_uct.py, step 0).
//
// The dump's keys are READ from tools/notebook_bench_report.py's DUMP_SCHEMA_KEYS, never retyped:
// the report is the one authority on the schema.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROBE = readFileSync(path.join(REPO, 'tools', 'bench_probes', 'bench_probe.js'), 'utf8')
const REPORT = readFileSync(path.join(REPO, 'tools', 'notebook_bench_report.py'), 'utf8')

function schemaKeys() {
  const m = REPORT.match(/DUMP_SCHEMA_KEYS\s*=\s*\(([\s\S]*?)\)/)
  if (!m) throw new Error('DUMP_SCHEMA_KEYS not found in tools/notebook_bench_report.py')
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
}
const PROBE_VERSION = PROBE.match(/PROBE_VERSION\s*=\s*'([^']+)'/)[1]

let clock = 0
const flush = () => new Promise((r) => setTimeout(r, 0))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function install({ hooks = true, visible = () => true } = {}) {
  window.__uctBench?._uninstall?.()
  // eslint-disable-next-line no-new-func
  new Function(PROBE)()
  if (hooks) window.__uctBench.setHooks({ now: () => clock, isVisible: visible })
  return window.__uctBench
}

function el(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  const node = d.firstElementChild
  document.body.appendChild(node)
  return node
}

function down(target) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
}

function key(target, k, opts = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }))
}

beforeEach(() => {
  document.body.innerHTML = ''
  clock = 1000
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  window.__uctBench?._uninstall?.()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the file itself', () => {
  it('is self-contained: no import, require or export, and it installs __uctBench with its version', () => {
    expect(PROBE).not.toMatch(/^\s*(import|export)\s/m)
    expect(PROBE).not.toMatch(/\brequire\(/)
    const api = install({ hooks: false })
    expect(api.version).toBe(PROBE_VERSION)
    expect(PROBE_VERSION).toMatch(/^uct-bench-probe\//)
  })
})

describe('open', () => {
  it('times the pointerdown to the first node ADDED after it that holds the marker', async () => {
    const api = install()
    const row = el('<button>Bench small note</button>')
    api.arm('open', { marker: 'zzqfixturefirst', mode: 'first', reps: 1, timeoutMs: 5000 })
    down(row)
    clock = 1123
    el('<p>lead zzqfixturefirst tail</p>')
    await flush()
    expect(api.samples('open')).toEqual([123])
    expect(JSON.parse(api.dump('fixture-app', 'H1')).invalid).toEqual([])
  })

  it('⛔ a marker already in the page at t0 makes the rep INVALID, never a 0 ms sample', async () => {
    const api = install()
    const row = el('<button>Bench small note</button>')
    el('<p id="old">zzqfixturefirst</p>')               // the target is already displayed
    api.arm('open', { marker: 'zzqfixturefirst', mode: 'first', reps: 1, timeoutMs: 5000 })
    down(row)
    clock = 1005
    document.getElementById('old').remove()               // a framework re-keys the node...
    el('<p>zzqfixturefirst</p>')                          // ...and re-adds it: the 0 ms trap
    await flush()
    expect(api.samples('open')).toEqual([])
    expect(JSON.parse(api.dump('fixture-app', 'H1')).invalid).toEqual(['marker-present-at-t0'])
  })

  it("'first' waits until the marker's node intersects the viewport (the injected check)", async () => {
    const api = install({ visible: (n) => n.getAttribute('data-vis') === 'yes' })
    const row = el('<button>row</button>')
    api.arm('open', { marker: 'zzqfixturefirst', mode: 'first', reps: 1, timeoutMs: 5000 })
    down(row)
    clock = 1050
    const p = el('<p data-vis="no">zzqfixturefirst</p>')
    await flush()
    expect(api.samples()).toEqual([])                    // in the DOM, not on screen: not yet
    clock = 1200
    p.setAttribute('data-vis', 'yes')
    await wait(60)                                       // the rAF poll picks it up
    expect(api.samples()).toEqual([200])
  })

  it("'full' needs the marker connected, not visible", async () => {
    const api = install({ visible: () => false })
    const row = el('<button>row</button>')
    api.arm('open', { marker: 'zzqfixturelast', mode: 'full', reps: 1, timeoutMs: 5000 })
    down(row)
    clock = 1400
    el('<p>zzqfixturelast</p>')
    await flush()
    expect(api.samples()).toEqual([400])
  })

  it('a timeout is recorded as not-in-dom, never a number', async () => {
    const api = install()
    const row = el('<button>row</button>')
    api.arm('open', { marker: 'zzqfixturelast', mode: 'first', reps: 1, timeoutMs: 100 })
    down(row)
    await wait(160)
    const d = JSON.parse(api.dump('fixture-app', 'H1'))
    expect(d.samples).toEqual([])
    expect(d.invalid).toEqual(['not-in-dom'])
    expect(d.status).toBe('COMPLETE')
  })

  it('clicks made while the target is displayed are navigation; the next open is the next rep', async () => {
    const api = install()
    const row = el('<button>row</button>')
    api.arm('open', { marker: 'zzqfixturefirst', mode: 'first', reps: 2, timeoutMs: 5000 })
    down(row)
    clock = 1100
    const shown = el('<p>zzqfixturefirst</p>')
    await flush()
    down(row)                                            // e.g. the neutral note, clicked while the target shows
    expect(api.status().attempts).toBe(1)
    shown.remove()                                       // the neutral note replaced it
    clock = 2000
    down(row)                                            // the target again: rep 2
    clock = 2075
    el('<p>zzqfixturefirst</p>')
    await flush()
    expect(api.samples()).toEqual([100, 75])
    expect(api.status().status).toBe('COMPLETE')
  })

  it("with an anchor, a gesture whose anchor never appears is navigation; one that opens the target but never holds the last marker is not-in-dom", async () => {
    const api = install()
    const row = el('<button>row</button>')
    api.arm('open', { marker: 'zzqfixturelast', anchor: 'zzqfixturefirst', mode: 'full', reps: 1, timeoutMs: 100 })
    down(row)                                            // opens something else
    await wait(160)
    expect(api.status()).toMatchObject({ attempts: 0, ignored: 1 })
    down(row)                                            // opens the target...
    el('<p>zzqfixturefirst</p>')                         // ...whose first screen shows
    await wait(160)                                      // ...but whose last paragraph never does
    const d = JSON.parse(api.dump('fixture-app', 'H3-full'))
    expect(d.invalid).toEqual(['not-in-dom'])
    expect(d.ignored).toBe(1)
    expect(d.target).toEqual({ marker: 'zzqfixturelast', anchor: 'zzqfixturefirst' })
  })

  it('records the press (pointerdown to pointerup) beside each open sample', async () => {
    const api = install()
    const row = el('<button>row</button>')
    api.arm('open', { marker: 'zzqfixturefirst', mode: 'first', reps: 1, timeoutMs: 5000 })
    down(row)
    clock = 1080
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    clock = 1190
    el('<p>zzqfixturefirst</p>')
    await flush()
    expect(JSON.parse(api.dump('fixture-app', 'H1')).press).toEqual([80])
  })
})

describe('search', () => {
  it('times the LAST keydown before the result, even when the title is split by a highlight', async () => {
    const api = install()
    const box = el('<input aria-label="search">')
    api.arm('search', { expectedTitle: 'Vireo cobalt almanac', reps: 1, timeoutMs: 5000 })
    key(box, 'v')                                        // first key, into an EMPTY field: t = 1000
    box.value = 'v'
    clock = 1040
    key(box, 'i')                                        // the last key before the result
    box.value = 'vi'
    clock = 1100
    el('<div role="option"><b>Vi</b>reo cobalt almanac</div>')
    await flush()
    expect(api.samples('search')).toEqual([60])
  })

  it('⛔ the expected title already in the page at the first keydown is INVALID', async () => {
    const api = install()
    el('<div>Vireo cobalt almanac</div>')
    const box = el('<input>')
    api.arm('search', { expectedTitle: 'Vireo cobalt almanac', reps: 1, timeoutMs: 5000 })
    key(box, 'v')
    el('<div>Vireo cobalt almanac</div>')
    await flush()
    expect(api.samples()).toEqual([])
    expect(JSON.parse(api.dump('fixture-app', 'H5')).invalid).toEqual(['marker-present-at-t0'])
  })

  it('only a typing key into an EMPTY field starts a rep; text inside the field itself never ends one', async () => {
    const api = install()
    const box = el('<div contenteditable="true"></div>')
    Object.defineProperty(box, 'isContentEditable', { value: true })
    api.arm('search', { expectedTitle: 'Vireo cobalt almanac', reps: 1, timeoutMs: 5000 })
    box.textContent = 'x'
    key(box, 'y')                                        // non-empty field: not a fresh query
    key(box, 'k', { ctrlKey: true })                     // a chord is not typing
    expect(api.status().state).toBe('ready')
    box.textContent = ''
    key(box, 'v')                                        // fresh query
    clock = 1030
    box.textContent = 'Vireo cobalt almanac'             // what was typed, inside the field
    await flush()
    expect(api.samples()).toEqual([])
    el('<li>Vireo cobalt almanac</li>')                  // the result, outside the field
    await flush()
    expect(api.samples()).toEqual([30])
  })
})

describe('typing', () => {
  function editor() {
    const ed = el('<div class="ProseMirror" contenteditable="true"></div>')
    Object.defineProperty(ed, 'isContentEditable', { value: true })
    return ed
  }
  async function typeKey(ed, ms) {
    key(ed, 'x')
    clock += ms
    ed.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(5)
  }

  it('keydown to the MessageChannel turn after the input event, one sample per key', async () => {
    const api = install()
    const ed = editor()
    api.arm('typing', { expectKeys: 3 })
    await typeKey(ed, 7)
    await typeKey(ed, 9)
    await typeKey(ed, 11)
    expect(api.samples('typing')).toEqual([7, 9, 11])
    expect(JSON.parse(api.dump('fixture-app', 'H6')).status).toBe('COMPLETE')
  })

  it('⛔ fewer samples than expectKeys is INCONCLUSIVE in the dump, never a p95 over the keys that landed', async () => {
    const api = install()
    const ed = editor()
    api.arm('typing', { expectKeys: 5 })
    await typeKey(ed, 7)
    key(ed, 'x')                                         // a key the editor never saw: no input
    await wait(5)
    await typeKey(ed, 9)
    const d = JSON.parse(api.dump('fixture-app', 'H6'))
    expect(d.samples).toEqual([7, 9])
    expect(d.expectKeys).toBe(5)
    expect(d.status).toBe('INCONCLUSIVE')
  })
})

describe('paste', () => {
  it('the paste event to the node holding the end marker; a second paste over it is INVALID', async () => {
    const api = install()
    const ed = el('<div contenteditable="true"></div>')
    api.arm('paste', { endMarker: 'zzqfixturepasteend', reps: 2, timeoutMs: 5000 })
    ed.dispatchEvent(new Event('paste', { bubbles: true }))
    clock = 1250
    el('<p>last paragraph zzqfixturepasteend.</p>')
    await flush()
    ed.dispatchEvent(new Event('paste', { bubbles: true }))   // the payload is still on screen
    const d = JSON.parse(api.dump('fixture-app', 'H8'))
    expect(d.samples).toEqual([250])
    expect(d.invalid).toEqual(['marker-present-at-t0'])
  })
})

describe('cold', () => {
  it('reads the buffered LCP entry, labelled an LCP proxy', async () => {
    const api = install()
    api.setHooks({ readLcp: async () => ({ ms: 812.5, size: 4096, element: 'DIV fixture' }) })
    await api.arm('cold')
    const d = JSON.parse(api.dump('fixture-app', 'H9'))
    expect(d.samples).toEqual([812.5])
    expect(d.label).toBe('LCP proxy')
  })

  it('no entry is recorded as a reason, never a number', async () => {
    const api = install()
    api.setHooks({ readLcp: async () => ({ error: 'no largest-contentful-paint entry was buffered' }) })
    await api.arm('cold')
    const d = JSON.parse(api.dump('fixture-app', 'H9'))
    expect(d.samples).toEqual([])
    expect(d.invalid[0]).toMatch(/^no-lcp: /)
  })
})

describe('selfTest and the dump', () => {
  it('selfTest arms its own hidden element and PASSES a 200 ms insertion (logic; the engine proof is Chromium)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const api = install({ hooks: false })
    const pending = api.selfTest()
    await vi.advanceTimersByTimeAsync(200)
    const r = await pending
    expect(r).toMatchObject({ ok: true, ms: 200, version: PROBE_VERSION, window: [195, 260] })
    expect(document.querySelector('[data-uct-bench-selftest]')).toBeNull()
    const d = JSON.parse(api.dump('fixture-app', 'H1'))
    expect(d.selfTest.ok).toBe(true)
    expect(d.hooks).toBeUndefined()                      // no hooks were installed
  })

  it("selfTest FAILS outside [195, 260] and never touches the member's own session", async () => {
    const api = install()
    const row = el('<button>row</button>')
    api.arm('open', { marker: 'zzqfixturefirst', mode: 'first', reps: 1, timeoutMs: 5000 })
    let t = 0
    api.setHooks({ now: () => (t += 150) })             // every reading 150 ms apart: 150 != 200
    const r = await api.selfTest()
    expect(r.ok).toBe(false)
    expect(api.status()).toMatchObject({ state: 'ready', attempts: 0 })   // untouched
    down(row)
    expect(api.status().state).toBe('pending')
  })

  it('a dump carries every key the report schema names, and a hooked dump says so', () => {
    const api = install()
    api.arm('open', { marker: 'zzqfixturefirst', mode: 'first', reps: 1 })
    const d = JSON.parse(api.dump('fixture-app', 'H1'))
    const keys = schemaKeys()
    expect(keys.length).toBeGreaterThanOrEqual(9)        // non-vacuity: the constant was read
    for (const k of keys) expect(d, `dump lacks ${k}`).toHaveProperty(k)
    expect(d.probeVersion).toBe(PROBE_VERSION)
    expect(d.hooks).toBe(true)
  })
})
