# Breadth Data Charts — C3 "touch & ARIA" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On tablets every control on Data Charts is finger-sized, as it already is on phones, and assistive technology
hears only what the controls actually do: More is a list of buttons that opens and closes, metric groups say whether they
are expanded, Notable Extremes says whether it is on, and Escape returns focus to the button that opened the list.

**Architecture:** Markup and stylesheet changes only. `PresetRow.jsx` becomes a disclosure (D-032); `BreadthCharts.jsx`
gains `aria-expanded`/`aria-controls` on group toggles and `aria-pressed` on Notable Extremes; the three stylesheets move
their finger-target rules to the TOUCH tier with `var(--tap-min)` (D-033), held by a rail that reads the stylesheets.

**Tech Stack:** React 19 (`useId`), CSS modules, Vitest 4 + Testing Library, Playwright rig (Python).

**Spec:** `docs/breadth/01-audit.md` A-19 (C), A-24 (C: attributes); `docs/breadth/02-design.md` §3 (keyboard: Escape
returns focus; arrow keys within popover lists are V2), §9 (≥ 44 px on the touch tier).

## Global Constraints

- Canonical breakpoints only: TOUCH `@media (max-width: 1024px)`, PHONE `@media (max-width: 640px)`. Finger targets use
  `var(--tap-min)`, never a typed `44px` (CLAUDE.md *Tap targets*; `styles/tapFloor.test.js`).
- A role promises behaviour: no `listbox`/`option`/`menu` until V2 builds the arrow keys that go with them.
- Phone LAYOUT rules (padding, font size, gaps) stay at ≤ 640; only finger targets move.
- Assert by role, name and attribute in tests; jsdom applies no CSS, so the touch rail reads the stylesheet text.
- Tests first, seen failing; own tool call before commit; named paths only. Acceptance: the six-shard gate adds no failing
  test to `docs/breadth/gates.md`'s latest set, and the rig at 768 px reports fewer controls under 44 px than the
  before-state (14 of 22).

---

## File structure

| File | Responsibility |
|---|---|
| Modify `app/src/pages/breadth/PresetRow.jsx` (+ `.module.css`, `.test.jsx`) | disclosure of buttons; Escape returns focus; panel items finger-sized |
| Modify `app/src/pages/BreadthCharts.test.jsx` | `clickPreset` and the More reachability test find buttons, not options |
| Modify `tools/breadth_charts_rig.py` | preset helpers find the More button and preset buttons by name |
| Modify `app/src/pages/BreadthCharts.jsx` | `aria-expanded`/`aria-controls` on group toggles; `aria-pressed` on Notable Extremes |
| Create `app/src/pages/BreadthCharts.a11y.test.jsx` | those attributes, by role and name |
| Modify `app/src/pages/BreadthCharts.module.css`, `app/src/pages/breadth/MetricReadout.module.css` | finger targets on the TOUCH tier |
| Create `app/src/pages/breadth/tapTier.test.js` | the stylesheet rail for A-19, with a control |

---

### Task 1: More is a disclosure of buttons (A-24)

- [ ] **Step 1: failing tests**

`PresetRow.test.jsx` — full file:

```jsx
// app/src/pages/breadth/PresetRow.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PresetRow from './PresetRow'

const PRESETS = [
  { id: 'health', label: 'Market Health', hint: 'the daily read', metrics: ['a'] },
  { id: 'thrust', label: 'Breadth Thrust', hint: 'ignition', metrics: ['b'] },
  { id: 'froth', label: 'Froth', group: 'Momentum', hint: 'late-move heat', metrics: ['c'] },
  { id: 'risk', label: 'Risk Appetite', group: 'Leadership', hint: 'who is bought', metrics: ['d'] },
]
const ORDER = ['Leadership', 'Momentum']

const setup = (props = {}) =>
  render(<PresetRow presets={PRESETS} groupOrder={ORDER} activePreset={null} onApply={() => {}} {...props} />)

const panelOf = trigger => document.getElementById(trigger.getAttribute('aria-controls'))
const listName = list => document.getElementById(list.getAttribute('aria-labelledby'))?.textContent

describe('PresetRow', () => {
  it('shows ungrouped presets as pills and keeps grouped ones closed behind More', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Market Health' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Breadth Thrust' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Froth/ })).toBeNull()
  })

  it('applies a preset from a pill', () => {
    const onApply = vi.fn()
    setup({ onApply })
    fireEvent.click(screen.getByRole('button', { name: 'Market Health' }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[0])
  })

  it('opens a disclosure in declared group order and applies from it', () => {
    const onApply = vi.fn()
    setup({ onApply })
    const trigger = screen.getByRole('button', { name: /^More/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    const panel = panelOf(trigger)
    expect(within(panel).getAllByRole('list').map(listName)).toEqual(['Leadership', 'Momentum'])

    fireEvent.click(within(panel).getByRole('button', { name: /^Risk Appetite/ }))
    expect(onApply).toHaveBeenCalledWith(PRESETS[3])
    expect(panelOf(trigger)).toBeNull()
  })

  // A-24: the list was a `listbox` of `option`s, promising arrow-key selection it never had.
  it('claims no listbox or option role it cannot honour', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByRole('button', { name: /^More/ }).hasAttribute('aria-haspopup')).toBe(false)
  })

  it('shows each hint so the list explains what it is offering', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    expect(screen.getByText('who is bought')).toBeTruthy()
  })

  // 02-design §3: Escape closes a popover and returns focus to its button.
  it('closes on Escape and returns focus to More; closes on an outside click', () => {
    setup()
    const trigger = screen.getByRole('button', { name: /^More/ })

    fireEvent.click(trigger)
    within(panelOf(trigger)).getByRole('button', { name: /^Froth/ }).focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panelOf(trigger)).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(panelOf(trigger)).toBeNull()
  })

  // The band must never look like nothing is selected just because the active
  // preset lives behind More.
  it('names the active preset on the trigger, and marks it pressed in the list', () => {
    setup({ activePreset: 'risk' })
    const trigger = screen.getByRole('button', { name: 'More: Risk Appetite' })
    fireEvent.click(trigger)
    expect(within(panelOf(trigger)).getByRole('button', { name: /^Risk Appetite/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(panelOf(trigger)).getByRole('button', { name: /^Froth/ }).getAttribute('aria-pressed')).toBe('false')
  })

  // On touch the pills scroll horizontally. If the list lived inside that scroll
  // container, `overflow-x: auto` would compute `overflow-y` to auto too and clip it.
  it('keeps the More trigger and its list out of the scrolling pill track', () => {
    setup()
    const trigger = screen.getByRole('button', { name: /^More/ })
    const pillTrack = screen.getByRole('button', { name: 'Market Health' }).parentElement
    expect(pillTrack.contains(trigger)).toBe(false)
    fireEvent.click(trigger)
    expect(pillTrack.contains(panelOf(trigger))).toBe(false)
  })

  it('marks the active pill and leaves the trigger plain', () => {
    setup({ activePreset: 'health' })
    expect(screen.getByRole('button', { name: 'Market Health' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })
})
```

`BreadthCharts.test.jsx` — `clickPreset` becomes:

```jsx
/** Presets without a `group` are pills; the rest live behind the More list. */
const clickPreset = name => {
  const pill = screen.queryByRole('button', { name })
  if (pill) return fireEvent.click(pill)
  fireEvent.click(screen.getByRole('button', { name: /^More/ }))
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${escaped}`) }))
}
```

and the reachability test's lookup becomes
`expect(screen.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeInTheDocument()`
with the popover wording in its comment changed to "More list".

- [ ] **Step 2:** `npx vitest run src/pages/breadth/PresetRow.test.jsx src/pages/BreadthCharts.test.jsx` → FAIL (roles, focus, attributes)
- [ ] **Step 3: implement** `PresetRow.jsx` — full file:

```jsx
import { useState, useRef, useEffect, useId } from 'react'
import UIcon from '../../components/ui/UIcon'
import styles from './PresetRow.module.css'

const slug = text => text.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

/**
 * Sixteen presets in one chrome band: one-click pills for the presets without a
 * `group`, and everything else behind More, grouped by `groupOrder`. Promoting a
 * preset between the two tiers is adding or removing its `group`.
 *
 * A-24 (D-032): More is a disclosure — a button that shows and hides lists of
 * buttons. It was a `listbox` of `option`s, which promises arrow-key selection the
 * list never had; V2 adds the keys and may then take a role that names them.
 * Escape closes the list and returns focus to More (02-design §3).
 */
export default function PresetRow({ presets, groupOrder, activePreset, onApply }) {
  const [open, setOpen] = useState(false)
  const moreRef = useRef(null)
  const triggerRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    const onDown = e => { if (!moreRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const core = presets.filter(p => !p.group)
  const grouped = presets.filter(p => p.group)
  const activeInMore = grouped.find(p => p.id === activePreset)

  function apply(preset) {
    onApply(preset)
    setOpen(false)
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>Presets</span>

      {/* Only the pills scroll on touch. If the row itself were the scroll
          container, `overflow-x: auto` would compute `overflow-y` to auto as
          well and clip the More list that drops out of it. */}
      <div className={styles.pills}>
        {core.map(p => (
          <button
            key={p.id}
            type="button"
            title={p.hint}
            aria-pressed={activePreset === p.id}
            className={`${styles.btn} ${activePreset === p.id ? styles.btnActive : ''}`}
            onClick={() => apply(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {grouped.length > 0 && (
        <div className={styles.more} ref={moreRef}>
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            className={`${styles.btn} ${activeInMore ? styles.btnActive : ''}`}
            onClick={() => setOpen(o => !o)}
          >
            {activeInMore ? `More: ${activeInMore.label}` : 'More'}
            <UIcon name="chevronDown" size={12} style={{ marginLeft: 4, verticalAlign: -1 }} />
          </button>

          {open && (
            <div id={panelId} className={styles.panel}>
              {groupOrder
                .filter(g => grouped.some(p => p.group === g))
                .map(g => {
                  const headingId = `${panelId}-${slug(g)}`
                  return (
                    <div key={g}>
                      <div id={headingId} className={styles.groupHeading}>{g}</div>
                      <ul className={styles.groupList} aria-labelledby={headingId}>
                        {grouped.filter(p => p.group === g).map(p => (
                          <li key={p.id}>
                            <button
                              type="button"
                              aria-pressed={activePreset === p.id}
                              className={`${styles.item} ${activePreset === p.id ? styles.itemActive : ''}`}
                              onClick={() => apply(p)}
                            >
                              <span className={styles.itemLabel}>{p.label}</span>
                              <span className={styles.itemHint}>{p.hint}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

`tools/breadth_charts_rig.py` — both preset helpers (lines 436–438, 514–518): the More click becomes
`root.get_by_role("button", name=re.compile(r"^More")).click()` and each preset click becomes
`root.get_by_role("button", name=re.compile("^" + re.escape(<name>))).first.click()`; confirm `import re` is present;
`grep -n "listbox\|get_by_role(\"option\")" tools/breadth_charts_rig.py` returns nothing; the file parses.

- [ ] **Step 4:** same command → PASS · **Step 5:** commit PresetRow.jsx, PresetRow.test.jsx, BreadthCharts.test.jsx, the rig — "Breadth charts: More is a list of buttons that opens and closes, and Escape returns focus (A-24)"

---

### Task 2: group toggles say whether they are open; Notable Extremes says whether it is on (A-24)

- [ ] **Step 1: failing test** `app/src/pages/BreadthCharts.a11y.test.jsx`

```jsx
// app/src/pages/BreadthCharts.a11y.test.jsx
//
// A-24: the metric group toggles opened and closed a list without saying so, and
// Notable Extremes switched lines on and off without saying which it was.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: shiftISO(todayET(), i - 9), breadth_score: 50 + i, pct_above_50sma: 40 + i,
}))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    const body = u.includes('/api/breadth-monitor/live') ? { ok: false }
      : u.includes('/api/breadth-monitor') ? { rows: ROWS }
      : u.includes('/api/auth/preferences') ? (opts?.method === 'POST' ? { ok: true } : {}) : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  }))
})

const renderTab = async () => {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}><BreadthCharts /></SWRConfig>)
  await waitFor(() => expect(screen.getByTestId('echart')).toBeInTheDocument())
}

describe('metric group toggles (A-24)', () => {
  it('say whether their list is open, and point at it', async () => {
    await renderTab()
    const toggle = screen.getByRole('button', { name: /^Regime/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const list = document.getElementById(toggle.getAttribute('aria-controls'))
    expect(within(list).getByLabelText('VIX')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('Notable Extremes (A-24)', () => {
  it('says whether it is on', async () => {
    await renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^MA Breadth/ }))
    const extremes = screen.getByRole('button', { name: /Notable Extremes/ })
    expect(extremes.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(extremes)
    await waitFor(() => expect(screen.getByRole('button', { name: /Notable Extremes/ }).getAttribute('aria-pressed')).toBe('true'))
  })
})
```

- [ ] **Step 2:** FAIL · **Step 3: implement** `BreadthCharts.jsx`: import `useId`; `const pickerId = useId()`; the group
  toggle gains `type="button"`, `aria-expanded={Boolean(expanded[g.group])}`,
  `aria-controls={`${pickerId}-${g.group.replace(/[^a-z0-9]+/gi, '-')}`}`; the metric list `div` gains the matching `id`;
  the Notable Extremes button gains `type="button"` and `aria-pressed={Boolean(notableExtremes[g.group])}`.
- [ ] **Step 4:** PASS · **Step 5:** commit — "Breadth charts: metric groups and Notable Extremes say their state (A-24)"

---

### Task 3: finger targets on the TOUCH tier (A-19)

- [ ] **Step 1: failing test** `app/src/pages/breadth/tapTier.test.js`

```js
/**
 * A-19: Data Charts enlarged its controls only at `max-width: 640px`, but the app's
 * touch tier is ≤ 1024 px — at 768 px, 14 of 22 controls measured under 44 px. jsdom
 * applies no CSS, so this reads the stylesheets, as chartWrapLayout.test.js does.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = rel => fs.readFileSync(path.resolve(here, rel), 'utf8').replace(/\r\n/g, '\n')
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of every `@media <query>` block, brace-matched. */
export function mediaBlocks(css, query) {
  const text = stripComments(css)
  const out = []
  let at = text.indexOf(`@media ${query}`)
  while (at >= 0) {
    let i = text.indexOf('{', at) + 1
    let depth = 1
    const start = i
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      i++
    }
    out.push(text.slice(start, i - 1))
    at = text.indexOf(`@media ${query}`, i)
  }
  return out
}

/** True when a rule inside `blocks` whose selector list names `selector` declares `prop: value`. */
export function declaresIn(blocks, selector, prop, value) {
  for (const block of blocks) {
    for (const [, sel, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!sel.split(',').map(s => s.trim()).includes(selector)) continue
      for (const chunk of body.split(';')) {
        const c = chunk.indexOf(':')
        if (c >= 0 && chunk.slice(0, c).trim() === prop && chunk.slice(c + 1).trim() === value) return true
      }
    }
  }
  return false
}

const TOUCH = '(max-width: 1024px)'
const TARGETS = [
  ['../BreadthCharts.module.css', '.groupBtn', 'min-height'],
  ['../BreadthCharts.module.css', '.extremesBtn', 'min-height'],
  ['../BreadthCharts.module.css', '.metricItem', 'min-height'],
  ['../BreadthCharts.module.css', '.dateLabel', 'min-height'],
  ['../BreadthCharts.module.css', '.dateInput', 'height'],
  ['../BreadthCharts.module.css', '.ftdToggle', 'min-height'],
  ['../BreadthCharts.module.css', '.loadProblemAction', 'min-height'],
  ['./MetricReadout.module.css', '.item', 'min-height'],
  ['./PresetRow.module.css', '.btn', 'min-height'],
  ['./PresetRow.module.css', '.item', 'min-height'],
]

describe('A-19: every Data Charts finger target reaches the floor on the touch tier', () => {
  for (const [file, selector, prop] of TARGETS) {
    it(`${file} ${selector} declares ${prop}: var(--tap-min) at ≤ 1024 px`, () => {
      expect(declaresIn(mediaBlocks(read(file), TOUCH), selector, prop, 'var(--tap-min)')).toBe(true)
    })
  }

  it('leaves no hand-typed 40/44 px finger height behind', () => {
    for (const file of new Set(TARGETS.map(t => t[0]))) {
      expect(stripComments(read(file)), file).not.toMatch(/(?:min-)?height:\s*4[04]px/)
    }
  })

  it('CONTROL — the reader sees a planted rule and refuses a phone-only one', () => {
    const css = '@media (max-width: 1024px) {\n  .a, .b { min-height: var(--tap-min); }\n}\n@media (max-width: 640px) {\n  .c { min-height: var(--tap-min); }\n}'
    const blocks = mediaBlocks(css, TOUCH)
    expect(declaresIn(blocks, '.b', 'min-height', 'var(--tap-min)')).toBe(true)
    expect(declaresIn(blocks, '.c', 'min-height', 'var(--tap-min)')).toBe(false)
  })
})
```

- [ ] **Step 2:** `npx vitest run src/pages/breadth/tapTier.test.js` → FAIL (group, extremes, metric rows, dates, FTD, chips, list items; typed 40/44 px)
- [ ] **Step 3: implement**

`BreadthCharts.module.css` — the phone block becomes layout only, and a touch block follows it:

```css
/* ── Phone — layout only; finger targets live in the touch tier below ─────── */
@media (max-width: 640px) {
  .container { padding: 12px 12px 24px; }
  .metricList { gap: 4px 16px; }
  .metricItem { font-size: 13px; }
}

/* ── Touch tier (≤ 1024) — every finger target reaches --tap-min (A-19) ──── */
@media (max-width: 1024px) {
  .groupBtn,
  .extremesBtn {
    min-height: var(--tap-min);
    padding-top: 0;
    padding-bottom: 0;
  }
  .metricItem { min-height: var(--tap-min); }
  .metricItem input[type="checkbox"],
  .ftdToggle input {
    width: 18px;
    height: 18px;
  }
  .dateLabel { min-height: var(--tap-min); }
  .dateInput { height: var(--tap-min); }
  .ftdToggle { min-height: var(--tap-min); }
}
```

`MetricReadout.module.css` — append:

```css
/* A-19: each chip toggles a series, so it is a finger target on the touch tier. */
@media (max-width: 1024px) {
  .item { min-height: var(--tap-min); }
}
```

`PresetRow.module.css` — the generated touch block's `.btn` rule becomes `.btn,\n  .item {\n    min-height: var(--tap-min);\n  }`
(each preset in the More list is a finger target too).

- [ ] **Step 4:** `npx vitest run src/pages/breadth/tapTier.test.js src/styles/tapFloor.test.js src/pages/breadth/chartWrapLayout.test.js src/styles/tokens.reachable.test.js` → PASS (tapFloor still names only `CaptureDialog.module.css: .actions`)
- [ ] **Step 5:** commit — "Breadth charts: finger-sized controls on tablets, not just phones (A-19)"

---

### Task 4: verify, gate, merge, member check

- [ ] Mutation proofs (harness; control first; bytes restored): `aria-expanded` dropped from group toggles → a11y test fails ·
  `aria-pressed` dropped from Notable Extremes → a11y test fails · `triggerRef.current?.focus()` dropped → Escape test fails ·
  `role="listbox"` put back on the panel → the no-listbox test fails · `.metricItem { min-height: var(--tap-min); }` removed
  from the touch block → tapTier fails · MetricReadout `.item` touch rule removed → tapTier fails.
- [ ] Six-shard gate vs the latest set in `gates.md`; named-list rails unchanged; record the C3 section.
- [ ] Merge origin/master; overlap check; watch coverage; guarded push; web SUCCESS; `/api/health` uptime reset.
- [ ] Member rig, local evidence: `python tools/breadth_charts_rig.py --widths 768,390 --no-failures --out docs/breadth/screenshots/after-c3 --json docs/breadth/measurements/after-c3.json` → the `under44` list at 768 against the before-state's 14 of 22.
- [ ] STATUS entry:

> **What members will see.** On tablets, Data Charts' buttons, date fields, checkboxes and readout chips are now
> finger-sized, as they already were on phones. Screen readers hear More as a list of buttons that opens and closes,
> metric groups say whether they are expanded, and Notable Extremes says whether it is on; Escape returns you to the
> More button.
