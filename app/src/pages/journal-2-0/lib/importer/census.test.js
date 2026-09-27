// Wave 10 lane 10B -- the import census rail (ruling R-18: "every major tool"
// = Notion, Evernote, Obsidian, OneNote, Apple Notes, Google Keep, Bear, Roam,
// Logseq, Joplin, each mapped to a native adapter or a documented generic path
// with a fixture).
//
// Asserted by what a member would SEE after an import -- a note's title and
// the text the converted body carries (`htmlToNote`'s bodyPlain, the same
// conversion the wizard runs), checkbox state from the converted body, tags,
// and the wizard's own warning sentences -- never by an adapter's internals.
// Each fixture goes through the real pipeline twice: dropped as a folder and
// dropped as ONE zip (the form Notion, Google Takeout and Roam hand members).
//
// Fixtures live in __fixtures__/ and are CONSTRUCTED from each vendor's
// documented export format; none is captured from a real account.
import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { IMPORT_CENSUS, R18_TOOLS } from './census'
import { ADAPTERS, detectAdapter } from './registry'
import { expandArchives } from './intake'
import { htmlToNote } from './convert'

// The Word path runs the REAL mammoth conversion. Vitest resolves mammoth's
// NODE entry, whose unzip takes `{buffer}`; the bundle Vite ships members
// applies mammoth's package `browser` field (`./lib/unzip.js` ->
// `./browser/unzip.js`), which takes the `{arrayBuffer}` that generic.js
// passes. Map that one option; nothing else about the conversion is stubbed.
vi.mock('mammoth', async (importOriginal) => {
  const real = await importOriginal()
  const m = real.default || real
  const convertToHtml = (input, options) =>
    m.convertToHtml(input && input.arrayBuffer ? { buffer: Buffer.from(input.arrayBuffer) } : input, options)
  return { ...real, convertToHtml, default: { ...m, convertToHtml } }
})

const FIXTURES = join(process.cwd(), 'src/pages/journal-2-0/lib/importer/__fixtures__')

function walk(dir, prefix = '') {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...walk(full, rel))
    else out.push({ rel, bytes: new Uint8Array(readFileSync(full)) })
  }
  return out
}

const toVFile = ({ rel, bytes }) => ({ path: rel, size: bytes.length, lastModified: null, bytes: async () => bytes })

function folderDrop(fixture) {
  return walk(join(FIXTURES, fixture)).map(toVFile)
}

function zipDrop(fixture) {
  const entries = {}
  for (const f of walk(join(FIXTURES, fixture))) entries[f.rel] = f.bytes
  const bytes = zipSync(entries)
  return [{ path: `${fixture.split('/').pop()}-export.zip`, size: bytes.length, lastModified: null, bytes: async () => bytes }]
}

async function importDrop(vfiles0) {
  const { files, warnings: intakeWarnings } = await expandArchives(vfiles0)
  const { adapter } = await detectAdapter(files)
  const { docs, warnings } = await adapter.parse(files)
  const notes = docs.map((d) => ({ ...d, ...htmlToNote(d.html) }))
  return { adapterId: adapter.id, notes, warnings: [...intakeWarnings, ...warnings] }
}

const byTitle = (notes, title) => {
  const n = notes.find((x) => x.title === title)
  if (!n) throw new Error(`no note titled "${title}" -- got: ${notes.map((x) => x.title).join(' | ')}`)
  return n
}

/** Every taskItem in a converted body, as {text, checked}. */
function taskItems(bodyJson) {
  const out = []
  const visit = (node) => {
    if (!node) return
    if (node.type === 'taskItem') {
      const text = []
      const collect = (n) => {
        if (n.type === 'text') text.push(n.text)
        ;(n.content || []).forEach(collect)
      }
      collect(node)
      out.push({ text: text.join('').trim(), checked: node.attrs?.checked === true })
    }
    ;(node.content || []).forEach(visit)
  }
  visit(bodyJson)
  return out
}

// What each tool's import must show. Keyed by census id; the census rail
// below fails if an entry exists without its expectation (or the reverse).
const EXPECT = {
  notion: ({ notes }) => {
    expect(byTitle(notes, 'My Page').bodyPlain).toContain('for the follow-up')
    expect(byTitle(notes, 'Sub Page').bodyPlain).toContain('Child page content')
  },
  evernote: ({ notes }) => {
    const n = byTitle(notes, 'Earnings week plan')
    expect(n.bodyPlain).toContain('Size down into the print.')
    expect(n.tags).toEqual(['earnings', 'plan'])
    expect(taskItems(n.bodyJson)).toEqual([
      { text: 'Set alerts on NVDA', checked: true },
      { text: 'Review last quarter', checked: false },
    ])
  },
  obsidian: ({ notes }) => {
    const n = byTitle(notes, 'VCP')
    expect(n.bodyPlain).toContain('Tightening contractions into a pivot.')
    expect(n.tags).toEqual(['setup', 'swing'])
    expect(n.links.map((l) => l.targetKey)).toContain('obsidian:Vault/Earnings plan.md')
    expect(byTitle(notes, 'Earnings plan').bodyPlain).toContain('Half size into the report.')
  },
  onenote: ({ notes }) => {
    const n = byTitle(notes, 'Weekly review')
    expect(n.bodyPlain).toContain('What worked')
    expect(n.bodyPlain).toContain('Waiting for the reclaim before adding kept the loss small.')
  },
  'apple-notes': ({ notes }) => {
    const n = byTitle(notes, 'Trade plan')
    expect(n.bodyPlain).toContain('Only take A+ setups this week.')
    expect(n.bodyPlain).toContain('Risk no more than half a percent')
  },
  'google-keep': ({ notes, warnings }) => {
    expect(notes).toHaveLength(2)
    const list = byTitle(notes, 'Watchlist')
    expect(taskItems(list.bodyJson)).toEqual([
      { text: 'NVDA into earnings', checked: true },
      { text: 'DDOG base breakout', checked: false },
    ])
    expect(list.tags).toEqual(['Trading'])
    expect(list.media.map((m) => m.name)).toEqual(['chart.jpg'])
    expect(list.folderPath).toEqual(['Google Keep'])
    expect(list.createdAt).toBe('2026-09-21T14:00:00.000Z')
    const untitled = byTitle(notes, 'Cut losers fast')
    expect(untitled.bodyPlain).toContain('Let winners run')
    expect(untitled.bodyPlain).toContain('Market wizards')
    expect(untitled.tags).toEqual(['Rules'])
    // the trashed note never becomes a live one, and the member is told
    expect(notes.some((x) => x.title === 'Old idea I deleted')).toBe(false)
    expect(warnings).toContain("Skipped 1 note that was in Google Keep's trash.")
    // Takeout's own .html twins and Labels.txt are not "files we ignored"
    expect(warnings.join(' ')).not.toMatch(/weren't recognized|wasn't recognized/)
  },
  bear: ({ notes }) => {
    const n = byTitle(notes, 'Morning routine')
    expect(n.bodyPlain).toContain('Read the wire, mark the levels, then wait. #process')
    expect(n.media.map((m) => m.name)).toEqual(['levels.png'])
  },
  roam: ({ notes }) => {
    const day = byTitle(notes, 'September 22nd, 2026')
    expect(day.bodyPlain).toContain('Watching Breakouts into the close')
    expect(day.links.map((l) => l.targetKey)).toContain('obsidian:Breakouts.md')
    // what the census's own "watch" line tells the member about to-dos
    expect(day.bodyPlain).toContain('{{TODO}} Trim the laggards')
    expect(IMPORT_CENSUS.find((t) => t.id === 'roam').watch).toContain('{{TODO}} and {{DONE}}')
    expect(taskItems(day.bodyJson)).toEqual([])
  },
  logseq: ({ notes, warnings }) => {
    // Logseq's own backup copy under logseq/bak is not a note
    expect(notes).toHaveLength(3)
    expect(notes.some((x) => x.bodyPlain.includes('OLD backup copy'))).toBe(false)
    const page = byTitle(notes, 'Setups/VCP')
    expect(page.bodyPlain).toContain('Tightening contractions into a pivot.')
    // review M-7: the member's OWN properties stay (a page one and a block one)…
    expect(page.bodyPlain).toContain('timeframe:: daily')
    expect(page.bodyPlain).toContain('entry:: 120')
    // …Logseq's bookkeeping goes, and so do the page properties that became
    // the title, tags and link names
    expect(page.bodyPlain).not.toMatch(/\b(id|collapsed|title|tags|alias)::|logseq\.order-list-type/)
    expect(page.tags).toEqual(['setup', 'swing'])
    expect(taskItems(page.bodyJson)).toEqual([
      { text: 'Backtest the last ten', checked: false },
      { text: 'Write the entry rules', checked: true },
    ])
    expect(page.folderPath).toEqual([])
    const day = byTitle(notes, '2026-09-22')
    expect(day.folderPath).toEqual(['Journals'])
    expect(day.createdAt).toBe('2026-09-22T16:00:00.000Z')
    expect(day.bodyPlain).toContain('Watched VCP names into the close')
    // [[VCP]] is an alias, [[Sep 21st, 2026]] a journal's default title
    expect(day.links.map((l) => l.targetKey).sort()).toEqual(
      ['logseq:graph/journals/2026_09_21.md', 'logseq:graph/pages/Setups___VCP.md'].sort()
    )
    expect(warnings.join(' ')).not.toMatch(/Obsidian/)
  },
  joplin: ({ notes }) => {
    const n = byTitle(notes, 'Weekly review')
    expect(n.bodyPlain).toContain('Stayed patient on the entries this week.')
    expect(n.tags).toEqual(['review', 'weekly'])
    expect(n.createdAt).toBe('2026-09-20 14:00:00Z')
    expect(n.media.map((m) => m.ref)).toEqual(['_resources/0a1b2c3d4e5f.png'])
  },
}

describe('import census (R-18) -- the list', () => {
  it('names exactly the ten tools of ruling R-18, in its order', () => {
    expect(IMPORT_CENSUS.map((t) => t.label)).toEqual(R18_TOOLS)
    expect(R18_TOOLS).toEqual([
      'Notion', 'Evernote', 'Obsidian', 'OneNote', 'Apple Notes',
      'Google Keep', 'Bear', 'Roam', 'Logseq', 'Joplin',
    ])
  })

  it('maps every tool to a registered adapter -- a native one of its own, or a documented shared path', () => {
    const ids = new Set(ADAPTERS.map((a) => a.id))
    for (const t of IMPORT_CENSUS) {
      expect(['native', 'documented'], t.label).toContain(t.route)
      expect(ids.has(t.adapterId), `${t.label} -> ${t.adapterId}`).toBe(true)
      if (t.route === 'native') expect(t.adapterId, t.label).not.toBe('file')
      expect(t.where.length, t.label).toBeGreaterThan(0)
      expect(t.format.trim(), t.label).not.toBe('')
      expect(t.watch.trim(), t.label).not.toBe('')
      expect(walk(join(FIXTURES, t.fixture)).length, `${t.label} fixture`).toBeGreaterThan(0)
    }
    expect(new Set(IMPORT_CENSUS.map((t) => t.id)).size).toBe(IMPORT_CENSUS.length)
    expect(Object.keys(EXPECT).sort()).toEqual(IMPORT_CENSUS.map((t) => t.id).sort())
  })
})

describe('import census (R-18) -- every tool imports through the real pipeline', () => {
  for (const tool of IMPORT_CENSUS) {
    for (const [form, drop] of [['folder', folderDrop], ['zip', zipDrop]]) {
      it(`${tool.label} (${form}) lands on the ${tool.adapterId} adapter and shows its notes`, async () => {
        const result = await importDrop(drop(tool.fixture))
        expect(result.adapterId).toBe(tool.adapterId)
        EXPECT[tool.id](result)
      })
    }
  }
})
