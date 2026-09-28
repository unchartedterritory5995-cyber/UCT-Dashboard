// app/src/pages/journal-2-0/a11y/loadFailedConsumers.test.js
//
// ⛔⛔ Wave 10 follow-up F7, Part A (clause 5d). A STRUCTURAL rail: every endpoint the proof walk
// of 26e03bbe8 found SILENT (a forced 500 and a dropped request both left no sentence on screen)
// is said by the consumer that shows its data, through the ONE shared element
// (components/LoadFailed.jsx: LoadFailed for a read, SaveFailed for a write).
//
// The rows are the walk's SILENT lines (the launcher log of run 26e03bbe8, 30 endpoints), each
// with the file that renders the sentence and the words that name what failed -- so taking one
// failure out of a consumer's list reds that endpoint's row, not merely "the file still imports
// it". The recents touch (POST /notes/{id}/opened) is NOT here: it is silent by design, declared
// with its reason in tools/notebook_proof_walk.py (SILENT_EXEMPT).
//
// ⭐ The verdict is the re-run of the silent sweep (docs/notebook/proof/f7-*); this file keeps a
// later edit from quietly unwiring a consumer between runs. It carries a CONTROL: the checker is
// run over a source without the element, and over one without the words, and must refuse both.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'src/pages/journal-2-0')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// [endpoint (as the walk names it), the consumer that SAYS it, the words that name it, the file
//  that READS it (the hook or the component that fetches), the literal that proves it fetches it]
const ROWS = [
  ['GET /api/j2/accounts', 'components/accounts/AccountSelector.jsx', 'your accounts', 'hooks/useJ2Accounts.js', "'/api/j2/accounts'"],
  ['GET /api/j2/accounts/comparison', 'components/accounts/AccountSelector.jsx', 'your current balances', 'hooks/useJ2AccountComparison.js', "'/api/j2/accounts/comparison'"],
  ['GET /api/j2/note-folders', 'components/notebook/FolderSidebar.jsx', 'your folders', 'hooks/useJ2NoteFolders.js', "'/api/j2/note-folders'"],
  ['GET /api/j2/notes/folder-counts', 'components/notebook/FolderSidebar.jsx', 'your folder counts', 'hooks/useJ2Notes.js', "'/api/j2/notes/folder-counts'"],
  ['GET /api/j2/notes/favorites', 'components/notebook/FolderSidebar.jsx', 'your favorites', 'hooks/useJ2Notes.js', "'/api/j2/notes/favorites'"],
  ['GET /api/j2/notes/recents', 'components/notebook/FolderSidebar.jsx', 'your recent notes', 'hooks/useJ2Notes.js', "'/api/j2/notes/recents'"],
  ['GET /api/j2/notes/tags', 'components/notebook/FolderSidebar.jsx', 'your tags', 'hooks/useJ2NoteTags.js', "'/api/j2/notes/tags'"],
  ['GET /api/j2/notes/connectors/status', 'components/connectors/NoteConnectorsTrustStrip.jsx', 'the sync status of your connected apps', 'hooks/useNoteConnectors.js', "'/api/j2/notes/connectors/status'"],
  ['GET /api/j2/saved-views', 'tabs/NotebookTab.jsx', 'your saved views', 'hooks/useJ2SavedViews.js', "'/api/j2/saved-views'"],
  ['GET /api/j2/property-defs', 'tabs/NotebookTab.jsx', 'your note properties', 'hooks/useJ2PropertyDefs.js', "'/api/j2/property-defs'"],
  ['GET /api/j2/onboarding/sample-notebook', 'components/notebook/ResearchHome.jsx', "your sample notebook's status", 'components/notebook/onboarding/sampleNotebook.js', "'/api/j2/onboarding/sample-notebook'"],
  ['GET /api/j2/notes/{id}/documents', 'components/notebook/NoteEditorPage.jsx', "this note's attachments", 'hooks/useNoteDocuments.js', '/documents`'],
  ['GET /api/j2/notes/{id}/excerpts', 'components/notebook/NoteEditorPage.jsx', "this note's saved passages", 'hooks/useNoteExcerpts.js', '/excerpts`'],
  ['GET /api/j2/notes/{id}/trade-ref/resolve', 'components/notebook/NoteEditorPage.jsx', "this note's linked trades", 'components/notebook/NoteEditorPage.jsx', '/trade-ref/resolve`'],
  ['GET /api/j2/notes/{id}/properties', 'components/notebook/PropertiesSection.jsx', "this note's properties", 'hooks/useNoteProperties.js', '/properties`'],
  ['GET /api/j2/notes/{id}/thesis-summary', 'components/notebook/NoteEditorPage.jsx', "this note's thesis evidence", 'hooks/useThesisSummary.js', '/thesis-summary`'],
  ['GET /api/j2/notes/{id}/facts', 'components/notebook/NoteEditorPage.jsx', "this note's captured facts", 'hooks/useNoteFacts.js', '/facts`'],
  ['GET /api/j2/notes/{id}/evidence-candidates', 'components/notebook/NoteEditorPage.jsx', "this note's evidence sources", 'hooks/useEvidenceCandidates.js', '/evidence-candidates`'],
  ['GET /api/j2/notes/{id}/backlinks', 'components/notebook/NoteBacklinksSection.jsx', 'the notes that link here', 'hooks/useNoteBacklinksList.js', '/backlinks`'],
  ['GET /api/j2/notes/{id}/related-from', 'components/notebook/NoteBacklinksSection.jsx', 'the notes related to this one', 'hooks/useNoteRelatedFrom.js', '/related-from`'],
  ['GET /api/j2/notes/{id}/unlinked-mentions', 'components/notebook/UnlinkedMentions.jsx', 'the notes that mention this one', 'components/notebook/UnlinkedMentions.jsx', '/unlinked-mentions`'],
  ['GET /api/j2/notes/research/{sym}/summary', 'components/notebook/TickerResearchWorkspace.jsx', 'your research on', 'hooks/useTickerResearch.js', '/summary`'],
  ['GET /api/j2/notes/{id}/share', 'components/notebook/NoteShareControls.jsx', "this note's share link", 'lib/noteShareLink.js', '/share'],
  ['GET /api/j2/publish', 'components/notebook/NoteShareControls.jsx', "this note's published pages", 'lib/notePublishLink.js', "'/api/j2/publish'"],
  ['GET /api/j2/personal/tokens', 'components/PersonalApiCard.jsx', 'your tokens', 'components/PersonalApiCard.jsx', "'/api/j2/personal/tokens'"],
  ['GET /api/j2/inbound-email/address', 'components/InboundEmailCard.jsx', 'your Notebook email address', 'components/InboundEmailCard.jsx', "'/api/j2/inbound-email/address'"],
  ['PATCH /api/j2/notes/{id}/tags', 'components/notebook/NoteEditorPage.jsx', "Couldn't add that tag.", 'hooks/useJ2Notes.js', '/tags`'],
  ['POST /api/j2/notes/{id}/favorite', 'components/notebook/NoteEditorPage.jsx', "Couldn't add this note to Favorites.", 'hooks/useJ2Notes.js', '/favorite`'],
]

/** Why a consumer source does NOT say this failure (null = it does). */
export function whyNotSaid(source, words) {
  const imports = /import\s+(?:LoadFailed\b[^;\n]*|\{[^}]*\bSaveFailed\b[^}]*\})\s+from\s+'(?:\.{1,2}\/)+(?:components\/)?LoadFailed'/.test(source)
  if (!imports) return 'does not import the shared LoadFailed element'
  if (!/<(LoadFailed|SaveFailed)\b/.test(source)) return 'imports it but never renders it'
  if (!source.includes(words)) return `never names this failure ("${words}")`
  return null
}

describe('every endpoint the walk found SILENT is said by its consumer, through the one element', () => {
  it('the table is the SILENT endpoints of run 26e03bbe8, less the one declared exempt', () => {
    // 60 SILENT rows = 30 (endpoint, action) pairs x {500, offline} = 29 endpoints (POST .../opened
    // was hit by two actions); POST .../opened is exempt by design (SILENT_EXEMPT in the walk).
    expect(new Set(ROWS.map((r) => r[0])).size).toBe(29 - 1)
  })

  for (const [endpoint, consumer, words, reader, literal] of ROWS) {
    it(`${endpoint} -- said by ${consumer}`, () => {
      expect(existsSync(join(ROOT, consumer)), consumer).toBe(true)
      expect(whyNotSaid(read(consumer), words)).toBeNull()
      // and the reader named really fetches that endpoint (a row cannot point at the wrong file)
      expect(read(reader)).toContain(literal)
    })
  }

  it('the shared element exists where every consumer imports it from', () => {
    const src = read('components/LoadFailed.jsx')
    expect(src).toMatch(/export default function LoadFailed/)
    expect(src).toMatch(/export function SaveFailed/)
  })
})

describe('CONTROL -- the checker can refuse', () => {
  it('a consumer that does not use the element is refused', () => {
    expect(whyNotSaid("import x from './Other'\nexport default () => <div>your folders</div>", 'your folders'))
      .toMatch(/does not import/)
  })
  it('a consumer that imports it and never renders it is refused', () => {
    expect(whyNotSaid("import LoadFailed from '../LoadFailed'\nexport default () => <div>your folders</div>", 'your folders'))
      .toMatch(/never renders/)
  })
  it('a consumer that renders it but dropped THIS failure from its list is refused', () => {
    expect(whyNotSaid("import LoadFailed from '../LoadFailed'\nexport default () => <LoadFailed what=\"your tags\" />", 'your folders'))
      .toMatch(/never names/)
  })
})
