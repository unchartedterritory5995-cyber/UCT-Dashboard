/**
 * DrillPlayer x UCT RS (RS 4-09): one REAL item of each RS family from
 * docs/study/bank/rs.drills.json, run through the player.
 *
 * StockChart is mocked (a 20k-line component), but the mock does what the
 * chart's binder does for each engine instance it is handed: `computeFor` on
 * the REAL rsLine definition with the chart's ctx ({sym, tf}). So a line that
 * prints here is a line the server lane would draw from the cache, and `fetch`
 * is spied on to prove no request leaves the drill.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

vi.mock('../../components/StockChart', async () => {
  const { computeFor, getDefinition } = await import('../../components/chart/engine/nativeRegistry')
  const finite = (col) => (col ? Array.from(col).filter(Number.isFinite).length : 0)
  return {
    default: (props) => {
      const insts = (props.settingsOverride?.indicatorInstances || []).filter((i) => i && !i.deleted)
      const rs = insts.filter((i) => i.defId === 'rsLine').map((i) => {
        const cols = computeFor(getDefinition('rsLine'), props.barsOverride || [], i.inputs, { sym: props.sym, tf: props.tf })
        return `${i.instanceId}=${finite(cols.rsLine)}/${finite(cols.dotNH)}`
      })
      return (
        <div data-testid="stock-chart" data-sym={props.sym}>
          <span data-testid="rs-lines">{rs.join('|') || '-'}</span>
          <span data-testid="markers">{(props.markers || []).map((m) => `${m.id}@${m.time}`).join('|') || '-'}</span>
          <span data-testid="annotations">{(props.annotations || []).length}</span>
          <span data-testid="callouts">{(props.callouts || []).length}</span>
          <button type="button" data-testid="tap-bar"
            onClick={() => props.onChartTap?.({ time: props.barsOverride[Number(window.__rsTapAt)].t, price: 1 })}>tap</button>
        </div>
      )
    },
  }
})

// The member's own chart settings (the widget look every Study chart wears, OWNER_PRINCIPLES rule 1) come from their
// preferences: served here as the defaults, so the no-request proof below stays about the RS data
vi.mock('../../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ prefs: real.PREFERENCE_DEFAULTS || {}, setPref: () => {}, loading: false }) }
})

import DrillPlayer from './DrillPlayer'
import { clearServerColumns } from '../../components/chart/engine/serverCompute'

const here = dirname(fileURLToPath(import.meta.url))
const BANK = JSON.parse(readFileSync(resolve(here, '../../../../docs/study/bank/rs.drills.json'), 'utf8'))
const tap = BANK.find((i) => i.type === 'tap' && i.reveal_json?.rs)
const pair = BANK.find((i) => i.prompt_json?.chart?.rs_pair)
const redDay = BANK.find((i) => i.prompt_json?.chart?.mark && i.reveal_json?.rs?.columns?.dotNH?.some((v) => v != null))
const recall = BANK.find((i) => i.type === 'recall')
/** The member-facing shape GET /api/study/today serves: no sym, no reveal, the bars inline. */
const served = (raw) => ({ id: raw.id, version: 1, type: raw.type, skill_id: raw.skill_id, prompt_json: raw.prompt_json,
  ...(raw.bars_embed ? { bars: { tf: 'D', bars: raw.bars_embed.bars } } : {}) })
const nonNull = (col) => col.filter((v) => v != null).length

/** The study API, answering as the server does: the reveal is reveal_json (+ forward bars) after scoring. */
function makeFetcher(raw) {
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/today') {
      return { session_id: 's', kind: 'daily', day_et: '2026-11-07', answered_item_ids: [], items: [served(raw), served(recall)] }
    }
    if (url === '/api/study/attempts' && opts.method === 'POST') {
      return {
        attempt_id: 1, item_id: raw.id, correct: true, score: 1,
        reveal: { ...raw.reveal_json, sym: raw.bars_embed?.sym, lesson: raw.lesson_text, answer: raw.answer_json, forward_bars: raw.bars_embed?.forward?.slice(0, 5) },
        progress: { xp_gained: 10, xp: 10, level: 1, streak: 1, streak_best: 1, due_at: null, weekly_xp: 10 },
      }
    }
    throw new Error(`unexpected ${url}`)
  })
}
const settle = () => new Promise((r) => setTimeout(r, 0))

let fetchSpy
beforeEach(() => {
  window.localStorage.clear()
  clearServerColumns()
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in a drill')))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => { vi.unstubAllGlobals(); delete window.__rsTapAt })

describe('DrillPlayer draws the real UCT RS pane on RS drills', () => {
  it('TAP: line without dots on the prompt, the real dots after scoring, scoring unchanged', async () => {
    const fetcher = makeFetcher(tap)
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    await screen.findByTestId('stock-chart')
    expect(screen.getByTestId('rs-lines')).toHaveTextContent('study:rs=120/0')
    expect(screen.getByText('Relative strength')).toBeInTheDocument()       // the skill chip

    window.__rsTapAt = tap.answer_json.bar_index
    fireEvent.click(screen.getByTestId('tap-bar'))
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByText('Continue')
    const post = fetcher.mock.calls.find(([u]) => u === '/api/study/attempts')
    expect(post[1].body.answer).toMatchObject({ bar_index: tap.answer_json.bar_index })   // the tap drill's own answer
    await waitFor(() => expect(screen.getByTestId('rs-lines'))
      .toHaveTextContent(`study:rs:reveal=120/${nonNull(tap.reveal_json.rs.columns.dotNH)}`))
    expect(screen.getByTestId('rs-lines')).not.toHaveTextContent('study:rs=')            // the prompt line is gone
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('LEADER: Line A and Line B on the market chart, no dot on either before scoring, the real dots after', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(pair)} />)
    await screen.findByTestId('stock-chart')
    // a new-high dot would name the leader (only it can have one): both prompt lines draw none
    expect(screen.getByTestId('rs-lines')).toHaveTextContent('study:rs:A=120/0|study:rs:B=120/0')
    expect(screen.getByTestId('rs-pair-key')).toHaveTextContent('Line A is the upper RS line, Line B the lower.')
    expect(screen.getByTestId('annotations')).toHaveTextContent('0')
    expect(screen.getByTestId('callouts')).toHaveTextContent('0')                       // and no candle pointer
    const names = Object.values(pair.reveal_json.example.names)
    for (const n of names) expect(document.body.textContent).not.toContain(n)
    fireEvent.click(await screen.findByRole('radio', { name: 'Line B' }))
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByText('Continue')
    const want = ['A', 'B'].map((n) => `study:rs:reveal:${n}=120/${nonNull(pair.reveal_json.rs_pair[n].columns.dotNH)}`)
    await waitFor(() => expect(screen.getByTestId('rs-lines')).toHaveTextContent(want.join('|')))
    expect(screen.getByTestId('rs-lines')).not.toHaveTextContent('study:rs:A=')        // the prompt lines are gone
    expect(screen.getByTestId('rs-lines')).not.toHaveTextContent('study:rs:B=')
    const leader = pair.reveal_json.facts.leader.slice(-1)
    expect(nonNull(pair.reveal_json.rs_pair[leader].columns.dotNH)).toBeGreaterThan(0)
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('RED DAY: the RS line with no dot, the muted mark, the candle pointer kept; the real dots after scoring', async () => {
    const fetcher = makeFetcher(redDay)
    render(<DrillPlayer open onClose={() => {}} fetcher={fetcher} />)
    await screen.findByTestId('stock-chart')
    expect(screen.getByTestId('rs-lines')).toHaveTextContent('study:rs=120/0')
    const t = String(redDay.prompt_json.chart.mark.time)
    expect(screen.getByTestId('markers')).toHaveTextContent(`study-rs-mark@${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`)
    expect(Number(screen.getByTestId('callouts').textContent)).toBeGreaterThan(0)      // the candle pointer (the shared callout)
    expect(screen.queryByTestId('rs-pair-key')).toBeNull()
    fireEvent.click(await screen.findByRole('radio', { name: 'Yes' }))
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByText('Continue')
    const post = fetcher.mock.calls.find(([u]) => u === '/api/study/attempts')
    expect(post[1].body.answer).toEqual({ choice: 'Yes' })                              // the spot drill's own answer
    await waitFor(() => expect(screen.getByTestId('rs-lines'))
      .toHaveTextContent(`study:rs:reveal=120/${nonNull(redDay.reveal_json.rs.columns.dotNH)}`))
    expect(screen.getByTestId('rs-lines')).not.toHaveTextContent('study:rs=')
    await settle()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a recall item after an RS chart draws no RS line of its own and keeps the chart mounted', async () => {
    render(<DrillPlayer open onClose={() => {}} fetcher={makeFetcher(redDay)} />)
    await screen.findByTestId('stock-chart')
    fireEvent.click(await screen.findByRole('radio', { name: 'Yes' }))
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByText('Continue')
    fireEvent.click(screen.getByTestId('primary-action'))
    await screen.findByText(recall.prompt_json.q)
    expect(screen.getByTestId('chart-box')).toHaveAttribute('data-chart-visible', '0')
    expect(screen.getAllByTestId('stock-chart')).toHaveLength(1)
  })
})
