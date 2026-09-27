/**
 * The import census (wave 10, lane 10B, ruling R-18): every major tool a
 * member brings notes from, the route each one takes in, and how to get the
 * export out of it.
 *
 * R-18's list, verbatim and in its order: Notion, Evernote, Obsidian,
 * OneNote, Apple Notes, Google Keep, Bear, Roam, Logseq, Joplin.
 *
 * ⛔ ONE AUTHORITY. `ExportGuide.jsx` renders THIS array (it held its own
 * three-platform list before wave 10), and `census.test.js` imports every
 * entry's fixture through the real pipeline -- intake -> detectAdapter ->
 * parse -> htmlToNote -- and asserts it lands on `adapterId`. A tool whose
 * route is not what this file says goes red by name.
 *
 * `route`:
 *  - 'native'     -- an adapter written for this tool reads its own format;
 *  - 'documented' -- no adapter of its own: the member follows the steps
 *                    below and the export lands on a shared adapter
 *                    (`adapterId` names which, measured by the fixture, not
 *                    assumed: Roam's Markdown carries `[[links]]`, so it lands
 *                    on the Obsidian reader, not the generic one).
 * `fixture` is a directory under `__fixtures__/`. Every census fixture is
 * CONSTRUCTED from the vendor's documented export format -- none is a capture
 * from a real account (this product holds none), and the report says so.
 *
 * Sources for the seven wave-10 entries, read 2026-09-26 (vendor UI moves;
 * this file will not notice):
 *  - OneNote: Microsoft's own "Export and Import OneNote notebooks" page covers
 *    only whole-notebook export from OneNote for the web; the desktop
 *    File -> Export -> Page/Section -> Word Document (*.docx) path is from
 *    Microsoft Q&A and third-party guides (thewindowsclub, note-bridge.co).
 *  - Apple Notes: File -> Export as -> Markdown (macOS Tahoe 26) and
 *    Share -> Export as Markdown (iOS 26), per MacRumors and AppleInsider;
 *    not from an Apple support page.
 *  - Google Keep: Google Account Help "How to download your Google data" and
 *    Takeout's per-note JSON (`textContent`/`listContent`/`isTrashed`/`labels`).
 *  - Bear: bear.app/faq/export-your-notes (Notes -> Cmd-A -> File -> Export
 *    notes..., free formats include Markdown and TextBundle).
 *  - Roam: Ness Labs' migration guide (... menu -> Export All -> Markdown).
 *  - Logseq: logseq/docs db-version.md ("Export graph" -> "Export as standard
 *    Markdown (no block properties)").
 *  - Joplin: joplinapp.org's Markdown-with-Front-Matter spec (fields, UTC
 *    dates, tags as a YAML list) and File -> Export all -> MD - Markdown +
 *    Front Matter.
 * The Notion / Obsidian / Evernote copy is carried over unchanged from the
 * pre-wave-10 ExportGuide, whose sources are in
 * .superpowers/sdd/2026-09-02-transfer-gap/task-1-report.md.
 */

export const R18_TOOLS = [
  'Notion',
  'Evernote',
  'Obsidian',
  'OneNote',
  'Apple Notes',
  'Google Keep',
  'Bear',
  'Roam',
  'Logseq',
  'Joplin',
]

export const IMPORT_CENSUS = [
  {
    id: 'notion',
    label: 'Notion',
    icon: 'document',
    route: 'native',
    adapterId: 'notion',
    fixture: 'notion',
    where: [
      'Whole workspace: Settings → General (under Workspace) → Export all workspace content.',
      'Just one page: open it, then the ••• menu at the top → Export.',
    ],
    format: 'Choose "Markdown & CSV" — it converts the cleanest here. Skip "HTML".',
    watch:
      "Notion emails you a download link instead of starting the download right away — for a big workspace that can take a while, and it may split into several zip files. Grab every part before you import, or you'll be missing notes with no warning that anything's gone. Also: any database/table over 50 rows won't come across — split it or trim it first.",
  },
  {
    id: 'evernote',
    label: 'Evernote',
    icon: 'book',
    route: 'native',
    adapterId: 'evernote',
    fixture: 'census/evernote',
    where: [
      'Open the Evernote app on a Mac or PC (not evernote.com in a browser) — right-click a notebook (or select up to 100 notes) → Export…',
    ],
    format: 'Choose ENEX (.enex) — the only format we read, and it\'s Evernote\'s own native one, so nothing is lost.',
    watch:
      "Evernote exports one notebook at a time, so several notebooks means several .enex files — that's fine, drop them all in together and we treat it as one import. Exporting only works from the desktop app, not the web version. And this is a one-time import, not an ongoing connection: Evernote has no \"keep syncing automatically\" option here (unlike Notion or Obsidian above) because its platform doesn't yet offer a reliable way to do that — when you add or change notes in Evernote later, just export and drop the file in again.",
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    icon: 'library',
    route: 'native',
    adapterId: 'obsidian',
    fixture: 'census/obsidian',
    where: [
      "Good news: there's no export step. Your vault is already a plain folder of Markdown files sitting on your computer.",
    ],
    format: "Nothing to pick — it's already Markdown.",
    watch:
      'Use "Choose a folder" below and point it at the top of the vault, not a subfolder, so nothing gets left out. A hidden ".obsidian" folder comes along for the ride — that\'s fine, we skip it automatically.',
  },
  {
    id: 'onenote',
    label: 'OneNote',
    icon: 'onenote',
    route: 'documented',
    adapterId: 'file',
    fixture: 'census/onenote',
    where: [
      'In OneNote for Windows (the desktop app): open the page or section, then File → Export → choose Page or Section → Word Document (*.docx) → Export.',
    ],
    format: 'Word Document (.docx) — we read Word files directly.',
    watch:
      "Each Word file becomes one note, so a whole section exported as one file arrives as one long note — export pages one at a time if you want one note per page. Word keeps text, headings, lists, tables and pictures; attached files and links between OneNote pages don't survive the Word export. OneNote for the web can only export a whole notebook, in a format we can't read.",
  },
  {
    id: 'apple-notes',
    label: 'Apple Notes',
    icon: 'edit',
    route: 'documented',
    adapterId: 'file',
    fixture: 'census/apple-notes',
    where: [
      'On a Mac with macOS Tahoe 26 or later: select the note (or several), then File → Export as → Markdown.',
      'On iPhone or iPad with iOS 26 or later: open the note → Share → Export as Markdown.',
    ],
    format: 'Markdown (.md).',
    watch:
      "This needs macOS 26 or iOS 26 — earlier versions can only export PDF, which we don't read. Drop in everything the export saved, the .md files and any pictures saved beside them, so your images come across.",
  },
  {
    id: 'google-keep',
    label: 'Google Keep',
    icon: 'pin',
    route: 'native',
    adapterId: 'keep',
    fixture: 'census/google-keep',
    where: [
      'Go to takeout.google.com, click "Deselect all", tick Keep, then Next step → Create export. Google emails you a download link.',
    ],
    format: 'The .zip Google gives you — drop it in as it is, no need to unzip.',
    watch:
      "Takeout also exports the notes sitting in Keep's trash — we skip those and tell you how many. Labels become tags and checklists keep their ticks. A very large account can arrive as several zip files — drop every part.",
  },
  {
    id: 'bear',
    label: 'Bear',
    icon: 'journal',
    route: 'documented',
    adapterId: 'file',
    fixture: 'census/bear',
    where: [
      'On a Mac: click Notes in the sidebar, press ⌘A to select every note, then File → Export notes… (⇧⌘S).',
      'On iPhone or iPad: open a note, tap the ••• button → Export.',
    ],
    format: 'Choose TextBundle — each note keeps its pictures with it. Plain Markdown works too.',
    watch:
      "Bear's #tags stay in the note's text; they don't become Notebook tags.",
  },
  {
    id: 'roam',
    label: 'Roam',
    icon: 'graph',
    route: 'documented',
    adapterId: 'obsidian',
    fixture: 'census/roam',
    where: ['In Roam: the ••• menu at the top right → Export All → choose Markdown.'],
    format: 'Markdown — Roam downloads one .zip; drop it in as it is.',
    watch:
      "Links between pages ([[like this]]) come across as links between notes. Roam's to-do boxes arrive as the text {{TODO}} and {{DONE}}, not as checkboxes, and a block reference shows its ID.",
  },
  {
    id: 'logseq',
    label: 'Logseq',
    icon: 'rows',
    route: 'native',
    adapterId: 'logseq',
    fixture: 'census/logseq',
    where: [
      'No export step: your graph is already a folder of Markdown files. Use "Choose a folder" and pick the graph\'s top folder — the one holding pages, journals and logseq.',
    ],
    format:
      'Nothing to pick. On Logseq\'s newer database version, use the ••• menu → Export graph → "Export as standard Markdown (no block properties)" instead.',
    watch:
      "Logseq's own backup copies (in logseq/bak) are skipped, so nothing imports twice. Page properties like tags:: become tags, TODO and DONE become checkboxes, and journals are titled by their date. Your own properties (like entry:: 120) stay in the note as text; Logseq's bookkeeping lines (id::, collapsed::) are left out.",
  },
  {
    id: 'joplin',
    label: 'Joplin',
    icon: 'save',
    route: 'documented',
    adapterId: 'file',
    fixture: 'census/joplin',
    where: ['In the Joplin desktop app: File → Export all → MD - Markdown + Front Matter, then pick an empty folder.'],
    format: 'MD - Markdown + Front Matter — it carries each note\'s title, tags and created / updated dates.',
    watch:
      "Drop in the whole export folder, including _resources, or your pictures won't come across. Joplin's JEX and RAW formats are Joplin-only and we don't read them.",
  },
]
