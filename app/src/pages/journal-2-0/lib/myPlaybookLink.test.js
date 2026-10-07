// lib/myPlaybookLink.js: where My Playbook lives and whether its door is open. The door on
// Insights links to PLAYBOOK_PATH; if that path stops matching a registered route the member
// clicks "My Playbook" and lands on the not-found page with every unit test green.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PLAYBOOK_FLAG, PLAYBOOK_PATH, playbookEnabled } from './myPlaybookLink'
import { FLAG_FALLBACKS, latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'
import { contract } from '../__fixtures__/contract'

afterEach(() => __resetNotebookFlags())

const SRC = path.resolve(__dirname, '..', '..', '..')
const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), 'utf8')

describe('playbookEnabled', () => {
  it('is off before any auth payload has arrived', () => {
    expect(playbookEnabled()).toBe(false)
  })

  it('is off when the payload does not carry the key (an older server)', () => {
    latchNotebookFlags({ notebook_offline_read_on: true })
    expect(playbookEnabled()).toBe(false)
  })

  it('is on only when the server sends a real true', () => {
    latchNotebookFlags({ [PLAYBOOK_FLAG]: true })
    expect(playbookEnabled()).toBe(true)
  })

  it.each([['false', false], ['the string "true"', 'true'], ['1', 1], ['null', null], ['an object', {}]])(
    'stays off for %s', (_label, value) => {
      latchNotebookFlags({ [PLAYBOOK_FLAG]: value, notebook_offline_read_on: true })
      expect(playbookEnabled()).toBe(false)
    })

  it('does not open later in the same tab once it latched off', () => {
    latchNotebookFlags({ [PLAYBOOK_FLAG]: false })
    latchNotebookFlags({ [PLAYBOOK_FLAG]: true })
    expect(playbookEnabled()).toBe(false)
  })

  it('reads a flag the latch really carries, defaulting to off', () => {
    // A key missing from FLAG_FALLBACKS is never latched, so the gate could never open.
    expect(Object.keys(FLAG_FALLBACKS)).toContain(PLAYBOOK_FLAG)
    expect(FLAG_FALLBACKS[PLAYBOOK_FLAG]).toBe(false)
  })
})

describe('PLAYBOOK_PATH', () => {
  it('is a route App.jsx registers', () => {
    const app = read('App.jsx')
    const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])
    expect(routes.length).toBeGreaterThan(40)                       // non-vacuity: the scan found the table
    expect(routes).toContain(PLAYBOOK_PATH)
  })

  it('is the path the route mounts My Playbook on, not some other page', () => {
    const app = read('App.jsx')
    const line = app.split('\n').find((l) => l.includes(`path="${PLAYBOOK_PATH}"`))
    expect(line).toMatch(/MyPlaybook/)
  })

  it('is what the Insights door links to', () => {
    const section = read('pages', 'journal-2-0', 'components', 'insights', 'PlaybookSection.jsx')
    expect(section).toMatch(/to=\{PLAYBOOK_PATH\}/)
    expect(section).not.toMatch(/to="\/journal-2-0\/playbook"/)      // one authority, never a second literal
  })
})

describe('the page behind the door reads the route the server serves', () => {
  it('My Playbook fetches /api/j2/my-playbook, which the contract fixture was recorded from', () => {
    expect(contract('my-playbook')._contract.endpoint).toBe('GET /api/j2/my-playbook')
    const page = read('pages', 'journal-2-0', 'components', 'insights', 'MyPlaybook.jsx')
    expect(page).toContain('/api/j2/my-playbook')
  })
})
