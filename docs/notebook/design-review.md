# Notebook design review -- UCT against Notion, Evernote and Obsidian (wave 10, lane 10E-2)

> ⭐ **RE-REVIEWED 2026-09-29 -- see `docs/notebook/design-review-2.md` (lane DR-R) for the
> current sign-off status.** This file is the first reviewer's record and is left unedited
> below this line.

Clause 6a of the 10/10 plan (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`:28: "a design review
against the three competitors signs off each surface"), under ruling R-14 as amended by
Amendment 1 (2026-09-27). Reviewed 2026-09-27 on master `d9e887ca0` by an agent session that built
no wave-10 code. **This is the reviewer's record; the owner countersigns it in S-2.** Until then
the clause reads *reviewed, not signed off*.

## What this review is, and what it is not

**The UCT half is hands-on.** Every UCT surface below was opened in the census-pinned sandbox
(`C:\data-w10e2`, port 8216, the production-armed Notebook flags, no model key) at **390, 820 and
1200 CSS px**, 390 and 820 with touch emulation, and captured with the measured facts a picture
cannot be trusted for: page-level horizontal overflow, targets under 24 px (and 44 px on the touch
widths), the visible headings. Record and images:
`docs/notebook/proof/e2-d9e887ca0/design/uct/` (`uct-captures.json` and one PNG per surface and
width; `uct_captures.py` reproduces them read-only).

**The competitor half is PUBLISHED MATERIAL ONLY -- not hands-on sessions.** By Amendment 1 there
was no purchase, no sign-in and no install. Each comparison below rests on an official help-centre
page, product page or template gallery, fetched in headless Chromium today with its URL, landing
URL, HTTP status and fetch date (`docs/notebook/proof/e2-d9e887ca0/design/competitor-capture.jsonl`,
17 pages, all 200), plus the controller's Evernote help-centre research read in a real Chrome on
2026-09-26 (`evernote-evidence-2026-09-26.jsonl`, 49 cells). Quotations are verbatim and at most 13
words; no third-party image is copied into this repository (the pages' own product images are
cited by URL in the capture record).

**What a hands-on session would have shown that this cannot** -- named so the gap is not read as
covered:

* **Empty and first-run states behind a login** -- what a new member of each product sees first,
  and how its onboarding hands off to a first note. Help pages describe features, never the empty
  account.
* **Paid-tier-only surfaces** -- Evernote's Personal/Professional features (the purchase was
  withdrawn), Notion's Plus/Business AI and site features, Obsidian Sync and Publish, which are
  paid add-ons. Their documentation says what they do, not how they look or feel in use.
* **Real density and rhythm at 390 / 820 / 1200** -- none of the three products' help pages show
  their own UI at those widths, so no measured side-by-side (overflow, target sizes, chrome height)
  is possible for the competitors. The UCT numbers below have no competitor column for that reason.
* **Motion, latency and focus behaviour** -- menus, drag, the feel of the editor; a screenshot or
  a paragraph carries none of it.
* **Mobile apps** -- Notion, Evernote and Obsidian ship native mobile apps; UCT is a responsive web
  page. The help pages cannot show the native apps' layouts.

Cost if wrong (the amendment's own words): 6a may score partial where a logged-in-only surface
matters; a later hands-on pass can upgrade this record.

## Surfaces, one verdict each

Verdict key: **AT PARITY** (UCT does what the published competitors do, at a comparable level of
polish in the captures), **BEHIND** (a named, fixable design gap), **AHEAD** (UCT does something the
published material says the competitors do not -- claimed only where the page says so, never from
silence).

### 1. The notes list and sidebar (folders, tags, saved views, Trash, Archived)

UCT (`uct-list-1200.png`, `-820`, `-390`): Recents, Saved Views, All notes / Unfiled / Archived /
Trash, nested folders, nested tags with counts; no overflow at any width.

Competitors: Notion's sidebar, *"The Notion sidebar allows you to:"* organise pages, with favourites
and teamspaces (notion.com/help/navigate-with-the-sidebar, 2026-09-27); Obsidian's file explorer,
*"Create, delete, and rename files and folders."* and *"Move files and folders with drag and
drop."* (obsidian.md/help/plugins/file-explorer, 2026-09-27); Evernote, *"pin notes to a notebook,
to Home, and add them to shortcuts"* (help.evernote.com AI Assistant article, G-023, 2026-09-26).

**Verdict: AT PARITY at 1200 and 820. BEHIND at 390** -- see D-1 and D-2 below: at 390 the
Journal's own header and the Notebook's folder panel fill the first screen before any note, and the
"Meet Compass" first-run card covers the lower list rows.

### 2. The editor

UCT (`uct-editor-1200.png`): title, subtitle, properties, evidence and changelog above the body; a
formatting row plus four further rows of note actions (Ask, Find, History, Share, folder, ticker,
tags, Duplicate, **Delete**, Lock, Archive, Save as template, Open beside, Writing help, Insert,
Outline, PNG, Print, Export).

Competitors: Notion's editing model is blocks with a hover handle -- *"⋮⋮ icon: This appears in the
left margin whenever you hover over a"* block (notion.com/help/writing-and-editing-basics,
2026-09-27); its page actions sit behind shortcuts, *"Use cmd/ctrl + F to search inside a page."*
(notion.com/help/keyboard-shortcuts). Evernote documents version history, *"Note history allows you
to view and restore older versions of a note."* (G-002).

**Verdict: AT PARITY on capability, BEHIND on density** -- D-3: up to five rows of controls sit
above the title at 1200, and a red Delete button is one of the first things on every note. Notion
and Evernote keep page-level actions in a menu and formatting in the flow of writing.

### 3. Views (table, board, calendar, graph, timeline, tasks)

UCT (`uct-board-1200.png`, `uct-graph-820.png`): seven view modes; the board groups by Thesis
Status with a per-card move control; the graph has a "Show as list" twin.

Competitors: Notion, *"Table: Tables allow you to see your database pages as rows, with every"*
property a column, and *"Board: This view groups your items by property."*
(notion.com/help/views-filters-and-sorts, 2026-09-27); Obsidian Bases, *"Each base can have several
views with different layouts such as tables and"* cards, and the graph, *"Graph view is a core
plugin that lets you visualize the relationships between"* notes (obsidian.md/help/bases,
/plugins/graph, 2026-09-27).

**Verdict: AT PARITY.** One interaction gap is design as much as accessibility and is carried to
the keyboard review: a Table view row opens only on a mouse click (A2R-02).

### 4. Templates

UCT: member templates ("Save as template", a Templates door on the list); a sample notebook on
first run.

Competitors: Notion's gallery, *"Personal Productivity24813 templates"* and *"Project
Management10142 templates"* (notion.com/templates, 2026-09-27); Evernote's gallery, *"Create the
perfect template for your needs and start using it."* (evernote.com/templates); Obsidian,
*"Templates is a core plugin that lets you insert pre-defined snippets of text"*
(obsidian.md/help/plugins/templates).

**Verdict: BEHIND Notion and Evernote on breadth** (D-4): both publish a browsable gallery; UCT has
member-made templates and one sample notebook. At parity with Obsidian's core model.

### 5. Share and publish

UCT: a private share link per note, publish a note or a folder to a public page, both revocable,
no-index. Competitors: Notion, *"Publish an unlimited number of pages to the web."*
(notion.com/help/public-pages-and-web-publishing); Obsidian Publish, *"Obsidian Publish is a
cloud-based hosting service that lets you publish your notes"* (obsidian.md/help/publish, a paid
add-on).

**Verdict: AT PARITY.** The public page itself could not be compared visually (their published
sites are live examples, but the reviewer did not open any, by the public-material rule's spirit
of reading documentation, not sampling third-party sites).

### 6. Search

UCT: body search, a quick switcher (Ctrl+K), date and property filters, Best matches. Evernote,
*"that match is highlighted both in the note list"* (G-014) and *"Searches for notes created on or
after the date specified."* (G-013); Notion, *"Use cmd/ctrl + P or cmd/ctrl + K to open search"*
(keyboard shortcuts). **Verdict: AT PARITY** (meaning search is dark by the owner's ZDR decision and
is not counted).

### 7. Phone (390)

UCT (`uct-list-390.png`, `uct-editor-390.png`): no horizontal overflow on any surface; no target
under 24 px; one target under 44 px per surface. Competitors: native apps (notion.com/mobile,
*"Work on the go with the Notion app."*); not comparable from public material (see the list above).
**Verdict: BEHIND** on the first screen (D-1, D-2), otherwise sound.

## Design findings (for the controller to file; nothing was changed)

| id | surface | width | finding | evidence |
|---|---|---|---|---|
| D-1 | list, editor | 390 | The Journal header (title, Log Trade, help, account, report, settings, more, then the section tabs) takes about the first 300 px before the Notebook starts, and a `?note=` URL shows the folder panel on the first screen, not the note. Notion/Evernote/Obsidian open straight into the page on a phone. | `uct-list-390.png`, `uct-editor-390.png` |
| D-2 | list, editor, board, graph | all | The "Meet Compass" first-run card sits over page content until dismissed (390: over the All notes / Unfiled rows; 1200: over the editor's evidence area). Named by 10B/10E-1 as well; confirmed here. | every `uct-*` capture |
| D-3 | editor | 1200 | Up to five rows of controls above the title; a red Delete button among the first controls on every note. | `uct-editor-1200.png` |
| D-4 | templates | -- | No browsable template gallery; the competitors publish thousands (Notion) or a gallery (Evernote). | competitor capture rows `templates` |
| D-5 | board | 1200 | The fourth column is cut at the right edge with no visible scroll affordance. | `uct-board-1200.png` |
| D-6 | editor | 1200 | 23 targets under 24 px on the editor at 1200 (the formatting row's B / I / H1 buttons, rename pencils); within 2.5.8's spacing exception in most cases, to be checked one by one. | `uct-captures.json` |

## Sign-off

| surface | reviewer (lane 10E-2, 2026-09-27) | owner countersign (S-2) |
|---|---|---|
| list and sidebar | at parity at 1200/820; behind at 390 (D-1, D-2) | |
| editor | at parity on capability; behind on density (D-3) | |
| views | at parity | |
| templates | behind Notion and Evernote on breadth (D-4) | |
| share and publish | at parity | |
| search | at parity | |
| phone | behind on the first screen (D-1, D-2) | |
