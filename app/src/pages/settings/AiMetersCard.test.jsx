/**
 * TERM-078 (FB-I1-04) — the member-visible AI meter card.
 *
 * Asserted by RENDERED TEXT, never by state (owner ruling 2026-09-09): a meter that
 * computes the right number and renders nothing is the defect this card exists to fix.
 *
 * ⛔ The load-bearing case is UNREADABLE: the doors fail OPEN while their counter
 * cannot be read, so the card must say so in words and must NOT render "0 / 40".
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import AiMetersCard, { METERS_URL, UNREADABLE_SENTENCE, LOAD_FAILED_SENTENCE } from './AiMetersCard'

const REFUSAL = "UCT's AI features have reached today's shared limit for the whole membership."

function payload(over = {}) {
  return {
    meters: [
      { key: 'notebook_ask', label: 'Ask Notebook questions', unit: 'questions', period: 'day',
        resets: 'midnight ET', readable: true, used: 12, limit: 40, remaining: 28, uncapped: false },
      { key: 'voice_one_shot', label: 'Compass one-shot questions', unit: 'questions', period: 'month',
        resets: 'the 1st of the month (UTC)', readable: true, used: 200, limit: 200, remaining: 0, uncapped: false },
    ],
    all_readable: true,
    population: { enforced: false },
    ...over,
  }
}

function mockFetch(body, ok = true) {
  const f = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }))
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AiMetersCard', () => {
  it('reads the meters endpoint and renders used / limit and what remains, as text', async () => {
    const f = mockFetch(payload())
    render(<AiMetersCard />)
    expect(await screen.findByText('12 / 40 questions')).toBeTruthy()
    expect(screen.getByText('28 left today · resets midnight ET')).toBeTruthy()
    expect(f).toHaveBeenCalledWith(METERS_URL, { credentials: 'include' })
  })

  it('says NONE LEFT and when it resets for an exhausted allowance', async () => {
    mockFetch(payload())
    render(<AiMetersCard />)
    expect(await screen.findByText('None left this month. Resets the 1st of the month (UTC).')).toBeTruthy()
  })

  it('an UNREADABLE counter says so in words and never renders as zero used', async () => {
    mockFetch(payload({
      meters: [{ key: 'notebook_ask', label: 'Ask Notebook questions', unit: 'questions',
        period: 'day', resets: 'midnight ET', readable: false, used: null, limit: 40,
        remaining: null, uncapped: false }],
      all_readable: false,
    }))
    render(<AiMetersCard />)
    expect(await screen.findByText(UNREADABLE_SENTENCE)).toBeTruthy()
    expect(screen.getByText('Unavailable')).toBeTruthy()
    expect(screen.queryByText(/0 \/ 40/)).toBeNull()
    expect(screen.queryByText(/40 left/)).toBeNull()
  })

  it('an uncapped allowance says no limit rather than drawing a bar', async () => {
    mockFetch(payload({
      meters: [{ key: 'voice_read_aloud', label: 'Compass read-aloud', unit: 'minutes', period: 'month',
        resets: 'the 1st of the month (UTC)', readable: true, used: 9, limit: null, remaining: null, uncapped: true }],
    }))
    render(<AiMetersCard />)
    expect(await screen.findByText('9 minutes this month · no limit')).toBeTruthy()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('shows the shared cap only while it is enforced, and renders the SERVER\'s refusal sentence', async () => {
    mockFetch(payload({ population: { enforced: true, readable: true, pct_used: 100, reached: true,
      resets: 'midnight ET', message: REFUSAL } }))
    render(<AiMetersCard />)
    expect(await screen.findByText('100% used today')).toBeTruthy()
    expect(screen.getByText(REFUSAL)).toBeTruthy()
  })

  it('renders no population row when the cap is off or in shadow', async () => {
    mockFetch(payload())
    render(<AiMetersCard />)
    await screen.findByText('12 / 40 questions')
    expect(screen.queryByTestId('ai-meter-population')).toBeNull()
  })

  it('a failed load says it failed, never an empty "no limits" card', async () => {
    mockFetch({}, false)
    render(<AiMetersCard />)
    expect(await screen.findByText(LOAD_FAILED_SENTENCE)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/No AI feature/)).toBeNull())
  })
})

describe('Settings mounts the AI allowances card (TERM-078)', () => {
  // Read by acorn-jsx AST, never grep: a commented-out mount is not a mount.
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const SRC = fs.readFileSync(path.join(HERE, '..', 'Settings.jsx'), 'utf8')
  const ast = Parser.extend(jsx()).parse(SRC, { ecmaVersion: 'latest', sourceType: 'module' })

  function walk(n, fn) {
    if (!n || typeof n.type !== 'string') return
    fn(n)
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach((c) => walk(c, fn))
      else if (v && typeof v.type === 'string') walk(v, fn)
    }
  }

  it('imports it and mounts it in the billing section', () => {
    const imp = ast.body.find((n) => n.type === 'ImportDeclaration'
      && n.specifiers.some((s) => s.local.name === 'AiMetersCard'))
    expect(imp?.source.value).toBe('./settings/AiMetersCard')
    let billing = null
    walk(ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.id?.name === 'sectionCards') {
        billing = n.init.properties.find((p) => (p.key.name ?? p.key.value) === 'billing')
      }
    })
    const cards = billing.value.elements.map((e) => [e.arguments[0].value,
      e.arguments[1].type === 'JSXElement' ? e.arguments[1].openingElement.name.name : null])
    expect(cards.length).toBeGreaterThan(1)               // non-vacuity: the section parsed
    expect(cards).toContainEqual(['aiMeters', 'AiMetersCard'])
  })

  it('is indexed for the settings search box', () => {
    let row = null
    walk(ast, (n) => {
      if (n.type === 'VariableDeclarator' && n.id?.name === 'SEARCH_INDEX') {
        row = n.init.elements.find((e) => e.properties.some((p) => p.key.name === 'card'
          && p.value.value === 'aiMeters'))
      }
    })
    const section = row?.properties.find((p) => p.key.name === 'section')?.value.value
    expect(section).toBe('billing')
  })
})
