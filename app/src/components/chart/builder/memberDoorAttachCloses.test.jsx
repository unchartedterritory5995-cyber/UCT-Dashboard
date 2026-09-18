// app/src/components/chart/builder/memberDoorAttachCloses.test.jsx
//
// ─── (j) j.5 — THE MEMBER DOOR'S SAVE LEAVES THE SHEET SITTING ON TOP OF THE
// THING IT JUST DREW (2026-09-18) ────────────────────────────────────────────
//
// ⚰️ WHAT WAS OBSERVED, AND WHAT IT ACTUALLY WAS. A capture run pasted
// `uncharted-clouds.pine` into the member door on a rig, clicked **Save**, and
// recorded that "Save and Cancel both leave the sheet open". Driving the real
// handlers rather than the pixels takes that one sentence apart into three
// separate facts, only one of which is a defect:
//
//   Cancel  is NOT broken. It goes through `requestClose` (BuilderSheet.jsx),
//           which on a dirty sheet opens the inline `discard-confirm` bar and
//           deliberately does not close until "Discard" is pressed. The bar
//           renders inside the sticky footer; what was read as "nothing
//           happened" was a confirm nobody had scrolled to. Pinned below.
//
//   Save    is the WRONG CONTROL for a pasted pane script, and it worked. It
//           stores the SCAN definition — one tree, one plot, the expression the
//           Formula tab is editing — which is what `attachPine`'s own header
//           says in the sheet: "IT IS A DIFFERENT DOCUMENT FROM THE ONE `save`
//           WRITES". Measured: the click posted a definition and rendered
//           "Saved — version 1, rev 1."
//
//   Attach  is the member door for a script, and it is the one with the defect.
//           `MemberPane`'s "Add this script to my chart" posts the 24-row pane
//           document and then hands back NOTHING: `attachPine` returned
//           `{ok:true}` and called neither `onSaved` nor `onClose`, so the
//           modal stayed over the chart it had just drawn twenty clouds on.
//
// ⛔⛔ AND THE SECOND HALF IS AT THE CALL SITE, NOT IN THE SHEET. `save()` has
// always ended in `onSaved?.(res.row)`, and the screener door
// (`ScreensManager.jsx`) and the pane harness both pass an `onSaved` that
// closes. `ChartToolbar.jsx` — the ONLY chart-door mount, and the one a member
// uses — passes `open`, `onClose`, `settings`, `onChange`, `bars`, `sym`, `tf`
// and **no `onSaved` at all**. So on that door the hand-back had nowhere to
// land even before the attach path skipped it. A test written against this
// file's own mount would restate the contract and pass; the second case below
// therefore READS `ChartToolbar.jsx`, which is the rule this repo already
// keeps for `contractArity` and `singleWriterIndex`.
//
// ⚠️ ON A SUCCESSFUL ATTACH THE PANE'S OWN "Saved, and added to this chart."
// NOTE NOW RENDERS FOR ZERO FRAMES on a door that closes — the failure mode
// `CLAUDE.md` records for a toast owned by the branch its own action unmounts.
// That is deliberate here and it is not a silence: the confirmation a member
// gets is the indicator drawn on the chart and its legend row, which is exactly
// what ticking the same script in the indicator library gives them. The note
// stays for any door that does not close (a preview mount passes no `onSaved`).
//
// ⛔ WHY THE RIG SAW NO ATTACH BUTTON AT ALL: `memberPaneEnabled()` reads
// `VITE_PINE_MEMBER_PANE_ENABLED` and defaults OFF, and the pane also needs
// `sym`+`tf`. The rig served a build with the flag unset, so the only control
// on screen was Save. Recorded so the next capture builds with it set rather
// than re-deriving this from a screenshot.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

import BuilderSheet from './BuilderSheet'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition'
import { AuthContext } from '../../../context/AuthContext'

const REPO = path.resolve(__dirname, '../../../../..')
const fixture = (n) => fs.readFileSync(path.join(REPO, 'tests/fixtures/member', n), 'utf8')
const CLOUDS = fixture('uncharted-clouds.pine')
const VOLUME2 = fixture('uncharted-volume-v2.pine')

const H = vi.hoisted(() => ({ requests: [], postOk: true }))
function stubFetch() {
  H.requests = []
  H.postOk = true
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    if (!H.postOk) {
      return { ok: false, status: 413, json: async () => ({ detail: 'That script is too large to store.' }) }
    }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const seen = { saved: [], closed: 0 }
function mount() {
  seen.saved = []
  seen.closed = 0
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet
          open
          onClose={() => { seen.closed += 1 }}
          onSaved={(row) => { seen.saved.push(row) }}
          settings={null}
          onChange={() => {}}
          sym="SPY"
          tf="D"
        />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

/** Paste a script into the one Import box and let its debounce settle. */
async function paste(script) {
  fireEvent.click(screen.getByRole('tab', { name: /^import$/i }))
  fireEvent.change(screen.getByTestId('pine-box').querySelector('textarea'), { target: { value: script } })
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}

const attachBox = () => screen.getByTestId('pine-member-pane-attach')
const posts = () => H.requests.filter((r) => r.method !== 'GET')
const postedDefinition = () => {
  const p = posts()
  const body = JSON.parse(p[p.length - 1].body)
  return body.definition ?? body
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.useFakeTimers()
  stubFetch()
})
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs()
})

describe('(j) j.5 — the member door hands back when a script is attached', () => {
  it('⭐⭐ attaching Clouds stores the PANE document and hands back through onSaved', async () => {
    mount()
    await paste(CLOUDS)
    fireEvent.click(attachBox().querySelector('button'))
    await flush(); await flush()

    // ⭐ DERIVED, NEVER TYPED. The row count is whatever `memberPaneDefinition`
    // builds from this fixture today; the claim under test is that the door
    // posts THAT document, not that it posts some number somebody remembered.
    const built = memberPaneDefinition({ source: CLOUDS, id: 'u_member-pane_clouds' })
    expect(built.ok).toBe(true)
    // ⛔ THE DISCRIMINATOR. The Formula tab's SCAN document carries one plot, so
    // a door that posted the wrong one would satisfy an equality check against
    // itself. This says the posted document is the many-row pane document.
    expect(built.definition.plots.length).toBeGreaterThan(1)
    expect(posts()).toHaveLength(1)
    expect(postedDefinition().plots).toHaveLength(built.definition.plots.length)

    // The defect: one hand-back, carrying the store's row.
    expect(seen.saved).toHaveLength(1)
    expect(seen.saved[0] && seen.saved[0].def_id).toBe('u_aaaaaaaaaaaa')
  })

  it('⭐⭐ the chart door\'s own <BuilderSheet> supplies an onSaved — read from ChartToolbar.jsx', () => {
    // ⛔ THE RUNTIME CALL SITE, NOT THIS FILE'S MOUNT. The mount above passes an
    // `onSaved` because the test needs one; asserting against it would prove
    // only that the test wired itself up. `ChartToolbar.jsx` is the door a
    // member opens, and it is the artifact that was missing the prop.
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'ChartToolbar.jsx'), 'utf8',
    )
    const ast = Parser.extend(jsx()).parse(src, { ecmaVersion: 2023, sourceType: 'module' })
    const elements = []
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.type === 'JSXOpeningElement' && node.name && node.name.name === 'BuilderSheet') {
        elements.push(node.attributes
          .filter((a) => a.type === 'JSXAttribute' && a.name)
          .map((a) => a.name.name))
      }
      for (const k of Object.keys(node)) {
        if (k === 'type' || k === 'start' || k === 'end') continue
        walk(node[k])
      }
    }
    walk(ast)

    // ⛔ NON-VACUITY. An empty list satisfies every "contains" check ever
    // written, so the probe first proves it found the element and can read the
    // props that were already there.
    expect(elements).toHaveLength(1)
    expect(elements[0]).toEqual(expect.arrayContaining(['open', 'onClose', 'settings', 'onChange', 'sym', 'tf']))

    expect(elements[0]).toContain('onSaved')
  })

  it('⛔ a REFUSED attach renders the store\'s own sentence and hands back nothing', async () => {
    mount()
    await paste(CLOUDS)
    H.postOk = false
    fireEvent.click(attachBox().querySelector('button'))
    await flush(); await flush()

    // The reason itself, asserted as TEXT — the half that talks to the member.
    expect(attachBox().textContent).toContain('That script is too large to store.')
    expect(seen.saved).toHaveLength(0)
    expect(seen.closed).toBe(0)
  })

  it('⛔ Cancel with unsaved work asks before it closes — it was never broken', async () => {
    mount()
    await paste(CLOUDS)
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }))
    await flush()
    // Not closed, and not silent: the confirm is on screen with its question.
    expect(seen.closed).toBe(0)
    expect(screen.getByTestId('discard-confirm').textContent).toContain('Discard this formula?')
    fireEvent.click(screen.getByTestId('discard-yes'))
    await flush()
    expect(seen.closed).toBe(1)
  })

  it('⛔ Volume v2 goes through the same door unchanged', async () => {
    mount()
    await paste(VOLUME2)
    fireEvent.click(attachBox().querySelector('button'))
    await flush(); await flush()

    const built = memberPaneDefinition({ source: VOLUME2, id: 'u_member-pane_v2' })
    expect(built.ok).toBe(true)
    expect(posts()).toHaveLength(1)
    expect(postedDefinition().plots).toHaveLength(built.definition.plots.length)
    expect(seen.saved).toHaveLength(1)
  })
})
