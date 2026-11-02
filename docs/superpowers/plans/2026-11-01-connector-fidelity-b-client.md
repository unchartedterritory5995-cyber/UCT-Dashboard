# Connector fidelity — Plan B: client file importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a member imports an Evernote `.enex`, an Obsidian vault zip or a Notion export zip, every link still points where it pointed and can be clicked, every image comes through, every file is kept, and nothing is dropped without a visible marker in the note and a line in the import report. Adds a "Re-import to recover" mode for past file imports.

**Architecture:** The adapters keep doing what only they can do: resolve references inside the export (Evernote title matching, Obsidian path rules, Notion page ids). Rules that apply to every source run in ONE new post-parse pass (`postParse.js::finishDoc`) on the adapter's HTML before conversion: linkify, href/scheme policy, `data:` and remote images turned into media items, media lifted out of links. On the commit side `commit.js` uploads raw bytes with the declared MIME (the server decides the type), copies remote images in through plan A's fetch route, and `rewriteBody` swaps every media placeholder for the stored media or for an `importNotice` node in the same place. One server change belongs to this plan: `import_confirm` gets an edit guard and a `mode: "recover"`.

**Tech Stack:** React + Vite, TipTap v3 (`generateJSON`), markdown-it 14 (its `linkify` instance, so no new dependency), DOMParser, spark-md5, fflate; Vitest + jsdom; FastAPI + SQLite, pytest.

**Spec:** `docs/superpowers/specs/2026-11-01-connector-fidelity-and-evernote-design.md` (§5.2 L-3, L-4, E-4/5/6/11/12/14, O-5/O-8/O-11, I-9; §5.3 I-1, I-5, I-6, I-7; §10; §15 Q1, Q5). Plan A (server: shared media policy, link fixes, `importNotice` node, internal-link openability and counting, placeholder heal) is being written in parallel. **This plan consumes plan A's interfaces and does not redefine them** (see "Interfaces consumed from plan A").

## Global Constraints

- "Any path that drops a member's content without a visible marker in the note" is a failure (spec §4). Every media item that is not stored ends as an `importNotice` node in its own position AND as a row in the import summary.
- "A hotlinked image that works today and breaks next month (store our own copy)" is a failure: an `http(s)` `<img>` is never left as a hotlink.
- Unsafe schemes `javascript:`, `data:`, `vbscript:`, `file:` on a link become plain text. App deep links `evernote:`, `notion:`, `obsidian:`, `onenote:` resolve to the imported note when possible, else plain text (L-4).
- A relative or `#fragment` link resolves against the web clip's source URL when one is known (Evernote `<source-url>`), else stays plain text. It never resolves against uctintelligence.com (L-4).
- Bare `https://…`, `http://…`, `www.…` and `mailto:` in plain text become links on every import path, never inside code marks or code blocks, with trailing punctuation handled the way linkify-it handles it (L-3).
- Evernote note links resolve by **link text == imported note title**. Ambiguous (duplicate title) ⇒ plain text plus a report line. Not found in this import ⇒ a resolvable placeholder that plan A's heal pass connects later, including against notes already in the notebook (Q5).
- Type comes from content, not file name (I-1): the client sends the declared MIME (Evernote `<mime>`, the `data:` header) with its parameters stripped, falls back to an extension hint only when nothing is declared, and lets the server sniff and decide.
- Re-import to recover (Q1): an explicit mode, never the default. An UNEDITED note is rebuilt in place even when its hash is unchanged. An EDITED note is never touched and gets a line in the report.
- Repo rails stay green: Notebook first-open byte budget (`python tools/notebook_perf_budgets.py --dist app/dist` after `npm run build`), so every new module is reached only through the importer's existing `await import(...)` chain; `app/src/pages/command/keyListenerCensus.test.js` (no new `document` keydown listeners, and this plan adds none); persistence census (no new localStorage keys); TERM-033 / `app/src/lib/swallowedFetch.census.test.js` (no `.catch(() => null)` on a response-body read; use `try { await res.json() } catch { /* named fallback */ }` the way `commit.js:254` does).
- Vitest: `vitest -t` is a regex, and a filter that matches nothing exits 0 as a false PASS. **Always run by file path**: `cd app && npx vitest run <path>`.
- Tests sit next to the files they test (repo convention).
- iOS 16 floor: no regex lookbehind (`app/src/noRegexLookbehind.test.js`).

## Review Focus

1. **Nested `<a>` inside `<a>` after an HTML re-parse.** ENML often wraps an `<en-media>` in a link. Once that media becomes an attachment-chip `<a>`, serialising and re-parsing makes the parser close the outer link early, so the link is silently lost (probe case Q). Lifting media out of links has to happen on the live ENML DOM, BEFORE `innerHTML`. Test: `evernote.test.js › "keeps the web link around an attachment as a link line after the chip"` (Task 6).
2. **A member's own image paste looks like the importer's finalize write.** The legacy "unedited" rule in recover mode keys on attachment-file mtimes, and a member who pasted an image within the import window could be misread as unedited. The guard: recover always takes a forced version checkpoint of the content it replaces, so a misclassification can still be restored from version history. Test: `test_recover_checkpoints_the_replaced_body_in_version_history` (Task 10).
3. **Caption text with a link right after an inline image** (probe case S: `<img>Caption with <a>link</a>`). After the image is lifted out of the paragraph, the link mark has to survive. Test: `postParse.test.js › "keeps a caption's link after an inline image"` (Task 3).
4. **Linkify must not touch a URL inside inline code, a code block, math or an existing link**, and must not turn a ticker such as `NVDA.US` into a link. Test: `linkPolicy.test.js › "never linkifies code, math, existing links, or a bare ticker-dot-TLD"` (Task 1).
5. **The same remote image used twice in one note, or in two notes.** One copy is fetched per (note, URL). A failure marks every occurrence, never only the first. Test: `commit.test.js › "fetches a repeated remote image once per note and marks every occurrence on failure"` (Task 5).

---

## Interfaces consumed from plan A (exact; plan A must provide these, reconcile there)

| # | Interface | Status |
|---|---|---|
| A1 | `POST /api/j2/notes/{noteId}/images` and `/attachments` accept the raw bytes under the client's declared MIME and run `media_policy.normalize_media(...)` (sniff, convert HEIC/TIFF/BMP/AVIF, downscale oversize, SVG kept as a file). **Response:** `{url: string, kind?: "image"\|"file", name?: string, original?: {url: string, name: string}}`. `kind` is missing or `"image"` = render inline; `"file"` = render as an attachment chip; `original` = a kept original (for example HEIC), shown as a chip right after the image. Refusals stay 4xx `{detail: string, reason?: string}`. | given (route) + **ASK** (`kind`/`original`/`reason` fields) |
| A2 | `POST /api/j2/notes/media/fetch` body `{url: string, noteImportKey?: string}` → 200 `{src: string, kind: "image"\|"file", filename: string}` or 422 `{reason: string, markerText: string}`. | given (brief). ⚠ storage is per note, so plan A resolves `noteImportKey` → note id for the caller. |
| A3 | TipTap block node `importNotice`, attrs `{reason: string, name: string\|null, sourceUrl: string\|null, ref: string\|null, attempts: number}`. The client writes it **as JSON only** (`rewriteBody`), so the client does not depend on its parseHTML. Plan A renders the copy from `reason` (the client's codes are in Task 4's `NOTICE_REASONS`) and makes `sourceUrl` a clickable "open original" link. | given + **ASK** (render every client reason code) |
| A4 | Internal note link href `/journal?j2tab=notebook&note=<id>` (what `commit.js:84` writes today). Plan A makes it openable (L-1) and counted in `j2_note_links` (L-2). | given |
| A5 | Placeholder `import-link://<key>` on a link mark stays in the stored body when it cannot be resolved yet. Plan A renders it as plain, non-clickable text and heals it when the target arrives. Keys the client emits: an importKey from the same export (`obsidian:<path>`, `notion:<path>`, `evernote:<nb>/<title>/<created>`), and **`evernote-title:<title>`** (not resolvable by key; heal = the unique active note with `import_source` = Evernote's source label whose `title` equals `<title>` exactly after trim/whitespace-collapse; more than one match stays unresolved). | given + **ASK** (`evernote-title:` key form) |
| A6 | `POST /api/j2/notes/import/heal-links` body `{noteIds: string[]}` → `{healed: number, unresolved: [{noteId: string, key: string, text: string}]}`. Called once at the end of `runImport` to get an honest "not connected yet" list. If it 404s or fails, the client falls back to its own list of placeholders it kept. | **ASK** |

Plan A's `import_confirm` pending-semantics change (§5.1) and this plan's Task 10 both edit `notes.py::import_confirm`. Whichever lands second rebases. Task 10 adds keyword arguments and response buckets and does not change the pending computation.

---

## File structure

| File | Responsibility |
|---|---|
| `app/src/pages/journal-2-0/lib/importer/linkPolicy.js` (new) | Linkify text nodes; resolve or neutralise an `href` (schemes, relative, `//`, `#`). Pure DOM helpers. |
| `app/src/pages/journal-2-0/lib/importer/mediaRefs.js` (new) | `IMAGE_EXT` (one copy for every adapter); `data:` image extraction; remote and unresolvable `<img>` → media items; lift media out of links. |
| `app/src/pages/journal-2-0/lib/importer/postParse.js` (new) | `finishDoc(doc)` runs the cross-source rules in a fixed order; `parseImport(adapter, vfiles, opts)` = `adapter.parse` + `finishDoc` on every doc. |
| `app/src/pages/journal-2-0/lib/importer/importNotice.js` (new) | `NOTICE_REASONS`, `importNoticeNode(...)`, `reasonForUploadFailure(status, body)`. |
| `app/src/pages/journal-2-0/lib/importer/evernoteLinks.js` (new) | Recognise Evernote note-link hrefs; resolve them across all docs of one parse by title. |
| `app/src/pages/journal-2-0/lib/importer/obsidianResolve.js` (new) | Obsidian's link resolution (vault root, `attachmentFolderPath`, same folder first, shortest path). |
| `adapters/evernote.js`, `adapters/obsidian.js`, `adapters/notion.js`, `adapters/generic.js` (modify) | Source-specific fixes; the shared `IMAGE_EXT`. |
| `commit.js`, `confirmBatches.js` (modify) | Upload by declared MIME, remote copy-in, notices, kept placeholders, heal call, recover mode. |
| `components/notebook/import/ImportWizard.jsx` (modify) | Call `parseImport`; recover checkbox; summary sections. |
| `api/services/journal_two/notes.py`, `api/routers/journal_two.py` (modify) | Edit guard, `mode="recover"`, finalize-write stamp. |
| `lib/importer/__fixtures__/corpora/**` + `corpora.*.test.js` (new) | §10 messy corpora, checked on the stored document and the rendered DOM. |

Shared doc/media shapes, used by every task (document them in `postParse.js`'s header JSDoc):

```js
/** @typedef {{ref: string, kind: 'image'|'file', name: string|null, vfile?: VFile,
 *   mime?: string,            // declared MIME, params allowed (stripped at upload)
 *   remoteUrl?: string,       // http(s) URL to copy in via A2
 *   failed?: {reason: string, sourceUrl: string|null}  // known-unstorable at parse time
 * }} MediaItem */
/** doc gains: sourceUrl?: string (http/https only) */
```

---

### Task 1: Link policy (linkify + href rules)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/linkPolicy.js`
- Test: `app/src/pages/journal-2-0/lib/importer/linkPolicy.test.js`

**Interfaces:**
- Consumes: `mdToHtml`'s markdown-it singleton. Export `getLinkify()` from `adapters/generic.js` returning `getMd().linkify`; it is the same instance, so there is one linkify behaviour.
- Produces:
  - `linkifyTextNodes(root: Element): number`: wraps matches in `<a href>` in place and returns how many links it made. Skips text under `a, code, pre, [data-type="inline-math"], [data-type="block-math"], [data-latex], [data-type="attachmentChip"]`. Keeps a match only if `match.schema` is `http:`, `https:` or `mailto:` (bare emails count, as in the markdown lane), or if the schema is empty and `match.raw` starts with `www.` (href gets `https://`). Every other fuzzy domain is dropped.
  - `resolveHref(href: string, sourceUrl?: string|null): string|null`: returns the href to keep, or `null` meaning "render as text". Rules, in order: trim; `import-link://`, `import-ref://`, `/journal`, `/terminal?cmd=` and `/api/j2/notes/attachments/` are returned unchanged; scheme in `javascript|data|vbscript|file` → null; scheme in `evernote|notion|obsidian|onenote` → null; any other scheme → unchanged; `//host…` → `https://host…`; otherwise (relative, `#…`, `?…`) → `new URL(href, sourceUrl).href` when `sourceUrl` is set and the result is http(s), else null.
  - `neutraliseAnchor(a: Element): void`: replaces `a` with its children (keeps bold, italic and media children). Never `textContent`.

- [ ] **Step 1: Write the failing tests**

```js
import { linkifyTextNodes, resolveHref, neutraliseAnchor } from './linkPolicy'
const dom = (html) => new DOMParser().parseFromString(html, 'text/html').body

it('linkifies http, https, www and mailto with linkify-it trailing punctuation', () => {
  const b = dom('<p>See https://finviz.com/quote.ashx?t=NVDA, www.tradingview.com/x. and mailto:me@x.com</p>')
  expect(linkifyTextNodes(b)).toBe(3)
  expect([...b.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
    'https://finviz.com/quote.ashx?t=NVDA', 'https://www.tradingview.com/x', 'mailto:me@x.com'])
  expect(b.textContent).toBe('See https://finviz.com/quote.ashx?t=NVDA, www.tradingview.com/x. and mailto:me@x.com')
})
it('never linkifies code, math, existing links, or a bare ticker-dot-TLD', () => {
  const b = dom('<p><code>https://a.com</code></p><pre>https://b.com</pre><span data-type="inline-math" data-latex="x">https://c.com</span><a href="https://d.com">https://e.com</a><p>NVDA.US example.com</p>')
  expect(linkifyTextNodes(b)).toBe(0)
})
it.each([
  ['javascript:alert(1)', null, null], ['JavaScript:x', null, null], ['vbscript:x', null, null],
  ['file:///C:/a.pdf', null, null], ['data:text/html,x', null, null],
  ['evernote:///view/1/s1/g/g/', null, null], ['onenote:https://x', null, null], ['obsidian://open?vault=V', null, null],
  ['/news/a-123', 'https://news.example.com/2026/clip', 'https://news.example.com/news/a-123'],
  ['#section', 'https://news.example.com/p', 'https://news.example.com/p#section'],
  ['/news/a-123', null, null], ['#section', null, null],
  ['//cdn.example.com/x.jpg', null, 'https://cdn.example.com/x.jpg'],
  [' https://spaced.example.com ', null, 'https://spaced.example.com'],
  ['import-link://obsidian:V/a.md', null, 'import-link://obsidian:V/a.md'],
  ['/journal?j2tab=notebook&note=abc', null, '/journal?j2tab=notebook&note=abc'],
  ['mailto:me@example.com', null, 'mailto:me@example.com'],
])('resolveHref(%s, %s) -> %s', (href, src, want) => expect(resolveHref(href, src)).toBe(want))
it('neutraliseAnchor keeps formatted and media children', () => {
  const b = dom('<p><a href="evernote:///x"><b>Bold</b> <img src="import-ref://h"></a></p>')
  neutraliseAnchor(b.querySelector('a'))
  expect(b.innerHTML).toBe('<p><b>Bold</b> <img src="import-ref://h"></p>')
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/linkPolicy.test.js`
Expected: FAIL, `Failed to resolve import "./linkPolicy"`.

- [ ] **Step 3: Implement `linkPolicy.js` and `getLinkify()` in `adapters/generic.js`**

Walk text nodes with `document.createTreeWalker(root, NodeFilter.SHOW_TEXT)`, collect them first and mutate afterwards. For each match, split the text node around `match.index`/`match.lastIndex` and insert `<a href=match.url>match.text</a>`.

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/linkPolicy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/linkPolicy.js app/src/pages/journal-2-0/lib/importer/linkPolicy.test.js app/src/pages/journal-2-0/lib/importer/adapters/generic.js
git commit -m "feat(importer): one link policy - linkify plain text, neutralise unsafe and app links, resolve relative against a source URL"
```

---

### Task 2: Media references (shared `IMAGE_EXT`, `data:` images, remote and unresolvable images, media lifted out of links)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/mediaRefs.js`
- Modify: `adapters/generic.js:30`, `adapters/notion.js:37`, `adapters/obsidian.js:74`. Delete each local `IMAGE_EXT` and import the shared one.
- Test: `app/src/pages/journal-2-0/lib/importer/mediaRefs.test.js`

**Interfaces:**
- Consumes: `resolveHref` (Task 1); `SparkMD5`.
- Produces:
  - `export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif|avif|tiff?)$/i`
  - `extractDataUriImages(root: Element, media: MediaItem[]): void`: every `img[src^="data:"]` (case-insensitive). Base64 or percent-encoded `image/*` → `src="import-ref://data-<md5 of bytes>"`, plus one media item per distinct hash `{ref, kind:'image', name:'image.<ext from mime>', mime, vfile}`. A non-image or undecodable `data:` → `src="import-ref://bad-data-<n>"` plus `{ref, kind:'image', name:null, failed:{reason:'decode_failed', sourceUrl:null}}`.
  - `collectRemoteImages(root: Element, media: MediaItem[], sourceUrl?: string|null): void`: every `img[src]` not starting `import-ref://` and not `/api/j2/notes/attachments/`. `src` goes through `resolveHref`. An http(s) result → `src="import-ref://remote-<md5(url)>"` plus one item per distinct URL `{ref, kind:'image', name: last path segment or null, remoteUrl}`. A null result → `src="import-ref://unresolvable-<n>"` plus `{ref, kind:'image', name: original src, failed:{reason:'unresolvable_src', sourceUrl:null}}`.
  - `liftMediaOutOfLinks(root: Element): void`: for each `a` (with `href` or `data-evernote-link`) that contains `img` or `[data-type="attachmentChip"]`, move those elements, in order, to just before the anchor. If the anchor then has no non-whitespace text: a web href (anything except `data-evernote-link`) gets its text set to the href, which becomes the visible link line; an Evernote note link is unwrapped with `neutraliseAnchor`.

- [ ] **Step 1: Write the failing tests**

```js
it('decodes a base64 data: image into an uploadable media item', () => {
  const b = dom(`<p><img src="data:image/png;base64,${PNG_B64}"></p>`); const media = []
  extractDataUriImages(b, media)
  expect(media).toHaveLength(1)
  expect(media[0]).toMatchObject({ kind: 'image', mime: 'image/png', name: 'image.png' })
  expect(b.querySelector('img').getAttribute('src')).toBe(`import-ref://${media[0].ref}`)
  expect(await media[0].vfile.bytes()).toEqual(pngBytes)
})
it('marks an undecodable data: image as failed in place', ...)          // failed.reason === 'decode_failed', img kept
it('turns http, https and protocol-relative hotlinks into one remote item per URL', ...)  // 2 imgs same URL -> 1 item, both srcs equal; http:// kept as http for the server fetch
it('resolves a root-relative clip image against the source URL', ...)  // '/relative/x.jpg' + sourceUrl -> remoteUrl 'https://news.example.com/relative/x.jpg'
it('marks a root-relative image with no source URL as unresolvable, never a UCT-relative src', ...)
it('lifts an image out of a web link and leaves the link as its own line after it', () => {
  const b = dom('<div><a href="https://tv.com/x/abc/"><img src="import-ref://h"></a></div>')
  liftMediaOutOfLinks(b)
  expect(b.innerHTML).toBe('<div><img src="import-ref://h"><a href="https://tv.com/x/abc/">https://tv.com/x/abc/</a></div>')
})
it('lifts media out of an Evernote note link and drops the now-empty link', ...)
it('IMAGE_EXT covers avif, tif, tiff, heif', () => ['a.avif','a.tif','a.TIFF','a.heif'].forEach((n) => expect(IMAGE_EXT.test(n)).toBe(true)))
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/mediaRefs.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `mediaRefs.js` and switch the three adapters to the shared `IMAGE_EXT`**

`data:` parse: `/^data:([^;,]+)((?:;[^;,]*)*),(.*)$/is`. Base64 when the params include `;base64`; otherwise `decodeURIComponent`. Wrap the decode in try/catch, and a catch counts as `decode_failed`.

- [ ] **Step 4: Run them, plus the adapter suites the `IMAGE_EXT` change touches**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/mediaRefs.test.js src/pages/journal-2-0/lib/importer/generic.test.js src/pages/journal-2-0/lib/importer/notion.test.js src/pages/journal-2-0/lib/importer/obsidian.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/mediaRefs.js app/src/pages/journal-2-0/lib/importer/mediaRefs.test.js app/src/pages/journal-2-0/lib/importer/adapters/generic.js app/src/pages/journal-2-0/lib/importer/adapters/notion.js app/src/pages/journal-2-0/lib/importer/adapters/obsidian.js
git commit -m "feat(importer): data: and remote images become media items; media lifted out of links; one IMAGE_EXT"
```

---

### Task 3: Post-parse pass and wizard wiring

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/postParse.js`
- Modify: `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx:363`. Replace `adapter.parse(vfiles, {...})` with `(await import('../../../lib/importer/postParse')).parseImport(adapter, vfiles, {...})`.
- Test: `app/src/pages/journal-2-0/lib/importer/postParse.test.js`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports; `heldBody` from `uctJson.js`.
- Produces:
  - `finishDoc(doc): doc`: mutates and returns the doc. It skips a doc whose `heldBody(doc.html)` is truthy (our own JSON export). Fixed order on one DOMParser parse of `doc.html`:
    1. `liftMediaOutOfLinks`
    2. every `a[href]`: `resolveHref(href, doc.sourceUrl)`, then set the href or `neutraliseAnchor`
    3. `extractDataUriImages`
    4. `collectRemoteImages`
    5. `linkifyTextNodes`
    6. write back `doc.html = body.innerHTML`, appending the new items to `doc.media` (deduped by `ref`, first wins).
  - `parseImport(adapter, vfiles, opts): Promise<{docs, warnings}>`: `adapter.parse` then `finishDoc` on each doc. Throws exactly what `adapter.parse` throws.

- [ ] **Step 1: Write the failing tests**

```js
it('applies the shared rules to an Evernote-shaped doc', () => {
  const d = finishDoc({ html: '<div>See https://a.com and <a href="/x">rel</a> <img src="https://cdn.com/c.png"></div>', media: [], sourceUrl: 'https://news.com/p' })
  expect(d.html).toContain('<a href="https://a.com">https://a.com</a>')
  expect(d.html).toContain('<a href="https://news.com/x">rel</a>')
  expect(d.media.map((m) => m.remoteUrl)).toEqual(['https://cdn.com/c.png'])
})
it('keeps a caption\'s link after an inline image', () => {   // Review Focus 3
  const d = finishDoc({ html: '<div><img src="import-ref://h">Caption with <a href="https://cap.com">link</a></div>', media: [] })
  const { bodyJson } = htmlToNote(d.html)
  const marks = JSON.stringify(bodyJson)
  expect(marks).toContain('"href":"https://cap.com"')
})
it('leaves a held UCT JSON body untouched', ...)
it('parseImport runs finishDoc over every doc an adapter returns', ...)  // fake adapter, 2 docs
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/postParse.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `postParse.js` and switch `ImportWizard.jsx` to `parseImport`**

The wizard keeps its own `onProgress` and cancellation exactly as today. Only the call changes.

- [ ] **Step 4: Run the new test and the wizard suites**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/postParse.test.js src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx src/pages/journal-2-0/components/notebook/import/ImportWizardBoundary.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/postParse.js app/src/pages/journal-2-0/lib/importer/postParse.test.js app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx
git commit -m "feat(importer): one post-parse pass applies the link and media rules to every source"
```

---

### Task 4: `rewriteBody` v2 (notices in place, kind switch, kept originals, kept placeholders)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/importNotice.js`
- Modify: `app/src/pages/journal-2-0/lib/importer/commit.js:49-151` (`rewriteBody`)
- Test: `app/src/pages/journal-2-0/lib/importer/commit.test.js`. Update `"removes link marks whose target did not import, keeping the text"` to the new contract (the mark is kept as a placeholder) and rename it `"keeps an unresolved link mark as an import-link placeholder for the heal pass"`.

**Interfaces:**
- Consumes: A3, A5.
- Produces:
  - `NOTICE_REASONS = { uploadFailed:'upload_failed', tooLarge:'too_large', typeRefused:'type_refused', storageLimit:'storage_limit', fetchFailed:'fetch_failed', unresolvableSrc:'unresolvable_src', decodeFailed:'decode_failed', missingResource:'missing_resource' }`
  - `importNoticeNode({reason, name=null, sourceUrl=null, ref=null, attempts=1}) -> {type:'importNotice', attrs:{reason, name, sourceUrl, ref, attempts}}`
  - `reasonForUploadFailure(status: number, body: object|null): string`: a string `body.reason` wins; otherwise 413 → `too_large`, 400/415 → `type_refused`, 507 → `storage_limit`, else `upload_failed`.
  - `rewriteBody(bodyJson, {mediaUrls?, mediaResults?, idByKey?}) -> {body, droppedMedia: string[], notices: Array<{ref, reason, name, sourceUrl}>, keptLinks: Array<{key, text}>}`
    - `mediaResults[ref]` is `{ok:true, src, kind, name, original?: {src, name}}` or `{ok:false, reason, name, sourceUrl}`. `mediaUrls[ref]` (string) is still accepted and means `{ok:true, src, kind: <the node's own kind>}`.
    - image node + ok: kind `image` → swap `src`; kind `file` → becomes `{type:'attachmentChip', attrs:{href: src, name}}`; `original` → an attachmentChip for it is inserted right after.
    - attachmentChip + ok → swap `href` (and `name` when the result has one).
    - not ok, or no entry at all → the node becomes `importNoticeNode({reason: result?.reason ?? 'missing_resource', name, sourceUrl, ref})`. The ref goes into `droppedMedia` and into `notices`.
    - link mark `import-link://<key>`: `idByKey[key]` → `/journal?j2tab=notebook&note=<id>` (A4). Unresolved → **the mark is kept unchanged** and `{key, text}` goes into `keptLinks`.
    - Walk returns arrays (`flatMap`) so one node can become two. Input is never mutated (the existing contract).

- [ ] **Step 1: Write the failing tests**

```js
it('replaces a failed image with an importNotice in the same position', () => {
  const body = doc([para('a'), img('import-ref://r1'), para('b')])
  const { body: out, notices, droppedMedia } = rewriteBody(body, { mediaResults: { r1: { ok: false, reason: 'fetch_failed', name: 'c.png', sourceUrl: 'https://cdn.com/c.png' } } })
  expect(out.content.map((n) => n.type)).toEqual(['paragraph', 'importNotice', 'paragraph'])
  expect(out.content[1].attrs).toEqual({ reason: 'fetch_failed', name: 'c.png', sourceUrl: 'https://cdn.com/c.png', ref: 'r1', attempts: 1 })
  expect(droppedMedia).toEqual(['r1']); expect(notices).toHaveLength(1)
})
it('a placeholder with no result at all becomes a missing_resource notice, never vanishes', ...)
it('an image the server stored as a file becomes an attachment chip', ...)   // kind:'file'
it('a kept original rides as a chip right after its converted image', ...)    // original present -> [image, attachmentChip]
it('replaces a failed image inside a table cell and a list item', ...)        // deep walk
it('keeps an unresolved link mark as an import-link placeholder for the heal pass', ...)  // keptLinks [{key:'obsidian:gone.md', text:'ghost'}]
it('still accepts the legacy mediaUrls map', ...)                              // existing first test unchanged
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/commit.test.js`
Expected: FAIL on the new cases (`importNotice` not produced; the placeholder mark gets dropped).

- [ ] **Step 3: Implement `importNotice.js` and `rewriteBody` v2**

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/commit.test.js`
Expected: PASS (including the existing scale test).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/importNotice.js app/src/pages/journal-2-0/lib/importer/commit.js app/src/pages/journal-2-0/lib/importer/commit.test.js
git commit -m "feat(importer): a media item that cannot be stored becomes an importNotice in place; unresolved note links stay healable"
```

---

### Task 5: Upload by declared MIME, remote copy-in, notices in the summary, heal call

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/importer/commit.js:193-263` (MIME table, `uploadMediaItem`) and `:446-517` (media phase of `runImport`)
- Test: `app/src/pages/journal-2-0/lib/importer/commit.test.js`

**Interfaces:**
- Consumes: A1, A2, A6; Task 4.
- Produces:
  - `declaredType(item: MediaItem): string`: `item.mime` stripped of `;…` params, trimmed and lowercased, when present; else the `MIME_BY_EXT` hint from `item.name`, then from `item.vfile.path` (table extended with `heic:'image/heic', heif:'image/heif', avif:'image/avif', tif:'image/tiff', tiff:'image/tiff', bmp:'image/bmp', svg:'image/svg+xml'`); else `'application/octet-stream'`. The header comment states that the server sniffs and is the authority (I-1).
  - `storeMediaItem(noteId: string, importKey: string, item: MediaItem): Promise<MediaResult>`. **Never throws.**
    - `item.failed` → `{ok:false, ...item.failed, name:item.name}` with no request.
    - `item.remoteUrl` → `POST /api/j2/notes/media/fetch` `{url, noteImportKey: importKey}` (A2). 200 → `{ok:true, src, kind, name: filename}`. 422 → `{ok:false, reason: body.reason, sourceUrl: url}`. Anything else → `reason:'fetch_failed'`.
    - otherwise the multipart upload (A1, `fetchWithRetry` as today). ok → `{ok:true, src: data.url, kind: data.kind || item.kind, name: data.name || item.name, original: data.original && {src: data.original.url, name: data.original.name}}`. Not ok → `reasonForUploadFailure(status, parsedBodyOrNull)`. The server's `detail` sentence still goes to `summary.failures` exactly as today.
  - `runImport` summary gains `notices: Array<{note: string, importKey: string, reason: string, name: string|null, sourceUrl: string|null}>` and `unconnectedLinks: Array<{note: string, text: string}>`. After the media/PUT loop it makes one `POST /api/j2/notes/import/heal-links {noteIds}` call over notes whose `keptLinks` was non-empty (A6). `unresolved` maps to `unconnectedLinks`. A non-ok status, an unreadable body or a network error falls back to every `keptLinks` entry.
  - The PUT body stays `{bodyJson, importMediaPending: droppedMedia.length > 0}`.

- [ ] **Step 1: Write the failing tests** (mock `fetch` by URL; capture the multipart `Blob.type` and the PUT body)

```js
it('sends the declared Evernote MIME for an extensionless web-clip image', ...)  // item {name:'clip-image', mime:'image/png; charset=binary'} -> Blob.type 'image/png', endpoint /images
it('falls back to an extension hint only when nothing is declared', ...)       // name 'x.heic' -> 'image/heic'
it('copies a remote image in through the fetch route and stores its src', ...)  // body {url, noteImportKey}; PUT body image src === returned src
it('fetches a repeated remote image once per note and marks every occurrence on failure', ...) // Review Focus 5: 2 placeholders same ref, 1 fetch call, 422 -> 2 importNotice nodes
it('a refused upload leaves an importNotice in the saved body and a notices row', ...)  // 413 -> reason too_large; summary.notices[0].reason === 'too_large'; importMediaPending true
it('a stored-as-file answer becomes a chip in the saved body', ...)
it('lists links the heal pass could not connect, and falls back to its own list when the route is missing', ...) // 404 -> unconnectedLinks from keptLinks
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/commit.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement `declaredType`, `storeMediaItem` and the `runImport` changes**

Per note, call `storeMediaItem` once per distinct `ref` and build `mediaResults`. Remove the old `uploadFailed` flag: `attentionKeys` now gets the note when `droppedMedia.length > 0`.

- [ ] **Step 4: Run the importer suite and the swallowed-fetch census**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/commit.test.js src/lib/swallowedFetch.census.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/commit.js app/src/pages/journal-2-0/lib/importer/commit.test.js
git commit -m "feat(importer): upload by declared type, copy remote images in, list what did not come over"
```

---

### Task 6: Evernote adapter (declared MIME, source URL, links keep their children, image inside a link, unmatched media)

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/importer/adapters/evernote.js:130-300`
- Test: `app/src/pages/journal-2-0/lib/importer/evernote.test.js`. Update any assertion that pinned `evernote:///` → bare text.

**Interfaces:**
- Consumes: `liftMediaOutOfLinks`, `IMAGE_EXT` (Task 2); `isEvernoteNoteHref` (Task 7; implement it in this task's commit if Task 7 has not landed, as specified there).
- Produces, on each doc:
  - `media[i].mime` = the resource's `<mime>` text (E-4 / I-1).
  - `sourceUrl` = `<note-attributes><source-url>` when it is http(s), else undefined. When set, the body starts with `<p>Source: <a href="URL">URL</a></p>` (E-12, visible and clickable).
  - Note-link anchors (`isEvernoteNoteHref(href)`) are no longer replaced by `textContent` (`:296-300` deleted). They get `data-evernote-link="1"`, keep `href` and keep every child (E-6).
  - `liftMediaOutOfLinks(enNote)` is called **on the live DOM, right after `replaceEnMedia`**, before anything serialises (E-4, E-11, Review Focus 1).
  - Unmatched `<en-media hash>` (E-14): pair it, in document order, with the next unreferenced resource whose kind matches `type` (an `image/*` type pairs only with an image resource). With no candidate, insert `<img src="import-ref://missing-<n>">` plus the media item `{ref:'missing-<n>', kind:'image', name:null, failed:{reason:'missing_resource', sourceUrl:null}}`.
  - Unreferenced resources still at the end are appended **as their own kind**: an image as `<img>`, a file as a chip. The `kind: 'file'` override at `:292` is removed.

- [ ] **Step 1: Write the failing tests** (reuse the file's `PNG_B64`/`pngMd5` helpers)

```js
it('carries the declared <mime> on every media item', ...)            // clip-image + image/png -> media[0].mime 'image/png'
it('keeps the clip source URL as a clickable first line and on the doc', ...)
it('keeps an image that sits inside an evernote:/// link', ...)       // probe D: html has <img src="import-ref://<md5>">, media has it
it('keeps bold inside an internal link', ...)                         // probe C: <b>Bold title</b> survives
it('keeps the web link around an image as a link line after it', ...) // probe P
it('keeps the web link around an attachment as a link line after the chip', ...) // probe Q, Review Focus 1
it('places a hash-mismatched image where its en-media was, not at the end', ...)  // probe J
it('marks an en-media with no resource at all as missing in place', ...)
it('appends an unreferenced image resource as an image, not a chip', ...)
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/evernote.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the Evernote adapter changes**

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/evernote.test.js src/pages/journal-2-0/lib/importer/census.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/adapters/evernote.js app/src/pages/journal-2-0/lib/importer/evernote.test.js
git commit -m "fix(importer/evernote): keep images, formatting and links inside note links; keep the clip source; declared MIME"
```

---

### Task 7: Evernote note links by title (E-5, Q5)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/evernoteLinks.js`
- Modify: `adapters/evernote.js` `parse()`: after every `.enex` has been parsed, call `resolveEvernoteLinks(docs, warnings)`. Delete `links: []` at `:169`.
- Test: `app/src/pages/journal-2-0/lib/importer/evernoteLinks.test.js`

**Interfaces:**
- Consumes: A5 (`evernote-title:` keys); `neutraliseAnchor` (Task 1).
- Produces:
  - `isEvernoteNoteHref(href: string): boolean`. True for `evernote:///view/…`, `evernote://view/…` (any case), `https://www.evernote.com/shard/<s>/nl/<uid>/<guid>…`, `https://www.evernote.com/shard/<s>/sh/<guid>/…`, `https://www.evernote.com/l/…` (and `evernote.com` without `www.`).
  - `normTitle(s: string): string` = trim + collapse whitespace to one space. Comparison is exact on `normTitle`.
  - `resolveEvernoteLinks(docs, warnings): void`. Map `normTitle(doc.title)` → importKeys. For every `[data-evernote-link]` in each `doc.html`, text = `normTitle(anchor text)`:
    - exactly one doc → `data-import-link="<that importKey>"`, remove `href` and `data-evernote-link`, push `{targetKey}` onto `doc.links`.
    - two or more → `neutraliseAnchor`, plus the warning ``Link "<text>" in "<doc.title>" was kept as text: more than one note is titled "<text>".``
    - none (or empty text) → empty text: `neutraliseAnchor`. Otherwise `data-import-link="evernote-title:<text>"` (A5, heals against this import's later re-runs and the existing notebook), pushed onto `doc.links`.

- [ ] **Step 1: Write the failing tests**

```js
it('links to the imported note whose title equals the link text', ...)        // probe A: html has data-import-link="evernote:<nb>/Target Note/<created>"
it('resolves share and shard links by title too', ...)                         // probe B
it('keeps an ambiguous title as text and says so', ...)                        // warnings match /more than one note is titled/
it('keeps a not-yet-imported target as an evernote-title placeholder', ...)    // data-import-link="evernote-title:Missing Note"
it('resolves across two .enex files dropped together', ...)
it.each(['evernote:///view/1/s1/g/g/', 'EVERNOTE://view/1/s1/g/g/', 'https://www.evernote.com/shard/s1/nl/1234/abcd/', 'https://www.evernote.com/l/AAAbbb/'])('isEvernoteNoteHref(%s)', (h) => expect(isEvernoteNoteHref(h)).toBe(true))
it('does not treat an ordinary evernote.com marketing link as a note link', ...) // 'https://evernote.com/pricing' -> false
it('end to end: the resolved link survives conversion and rewriteBody', ...)    // parse -> htmlToNote -> rewriteBody(idByKey) -> href /journal?j2tab=notebook&note=<id>
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/evernoteLinks.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `evernoteLinks.js` and the `parse()` call**

- [ ] **Step 4: Run them and the Evernote adapter suite**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/evernoteLinks.test.js src/pages/journal-2-0/lib/importer/evernote.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/evernoteLinks.js app/src/pages/journal-2-0/lib/importer/evernoteLinks.test.js app/src/pages/journal-2-0/lib/importer/adapters/evernote.js
git commit -m "feat(importer/evernote): note links resolve to the imported note by title; ambiguous ones are named"
```

---

### Task 8: Obsidian resolution (I-9, O-5, O-8, O-11, `obsidian://`)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/obsidianResolve.js`
- Modify: `adapters/obsidian.js` (replace `buildBasenameMap`/`resolveTarget`/`resolvePathQualified` with the resolver; `transformEmbeds`, `transformWikiLinks`, `makeDoc`); `adapters/generic.js:318`. `resolveRelativeMedia(html, dir, byPath, fallbackResolve?)` gets an optional fourth parameter `(rel: string) => string|null`, used only when the dir-relative path misses.
- Test: `app/src/pages/journal-2-0/lib/importer/obsidianResolve.test.js`, `app/src/pages/journal-2-0/lib/importer/obsidian.test.js`

**Interfaces:**
- Produces:
  - `async makeObsidianResolver(vfiles: VFile[]): Promise<{root: string, resolve(linkpath: string, sourcePath: string, {decode?: boolean}?): string|null}>`
    - `root` = the directory holding `.obsidian/` (`''` when there is none). `attachmentFolderPath` is read from `<root>/.obsidian/app.json` (JSON; missing or bad → `'/'`).
    - `resolve`: drop `#…` and `|…`; remove one trailing `\` (O-8); `decodeURIComponent` once when `decode` is set (markdown hrefs; never wikilinks). Order:
      1. a leading `/` → root-relative exact.
      2. a path containing `/` → source-dir-relative exact, then root-relative exact, each tried as written and with `.md` appended when there is no extension.
      3. by name: every file whose basename matches case-insensitively (with `.md` added when there is no extension). Prefer the source file's own folder, then the resolved attachment folder (`'./x'` = the source's dir + `/x`; `'/'` = root; otherwise root + the value), then fewest path segments, then shortest string, then lexicographic.
      4. a path containing `/` with no exact hit → `/`-boundary suffix match, using the same tie order.
- Adapter behaviour:
  - O-11: an embed `![[X]]` that resolves to `.md` → `<a data-import-link="obsidian:<path>">X without .md/fragment</a>`, pushed onto `links` (not an attachment chip).
  - O-8: `| [[Other note\|alias]] |` resolves, and the display text is `alias`.
  - O-5: after `resolveRelativeMedia`, every remaining relative `a[href]` → `resolve(href, vfile.path, {decode:true})`. A `.md` target → `data-import-link`; any other existing target → attachment chip plus media item; a miss is left for the post-pass, which neutralises it.
  - `obsidian://open?…&file=<f>` → resolve `f` (URL-decoded once) as a wikilink target. A hit → `data-import-link`; a miss is left for the post-pass, which neutralises it.
  - I-9: `![](attachments/x.png)` from a note in a subfolder resolves via `fallbackResolve` to `<root>/attachments/x.png`.

- [ ] **Step 1: Write the failing tests**

```js
// obsidianResolve.test.js — vault: V/.obsidian/app.json {"attachmentFolderPath":"Files"}, V/A/n.md, V/B/x.png, V/Files/x.png, V/A/x.png, V/Deep/er/x.png
it('prefers the same folder', ...)                          // resolve('x.png','V/A/n.md') -> 'V/A/x.png'
it('then the attachment folder', ...)                       // from V/C/m.md -> 'V/Files/x.png'
it('then the shortest path', ...)                           // no attachmentFolderPath, from V/C/m.md -> 'V/B/x.png' over 'V/Deep/er/x.png'
it('decodes a markdown href once and appends .md', ...)     // 'Other%20note' -> 'V/Other note.md'
it('strips the escaped table pipe', ...)                    // 'Other note\\' -> 'V/Other note.md'
// obsidian.test.js
it('resolves a relative markdown link to the note', ...)    // [x](../Notes/Other.md) and [x](Other%20note.md) -> data-import-link
it('resolves a wikilink with an escaped pipe in a table', ...)
it('makes ![[Other note]] a note link, not a file chip', ...)
it('resolves a vault-root image path from a subfolder note', ...)
it('resolves an obsidian://open link to the note', ...)
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/obsidianResolve.test.js src/pages/journal-2-0/lib/importer/obsidian.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the resolver and the adapter changes**

`parse()` awaits `makeObsidianResolver(vfiles)` once, before the per-file loop.

- [ ] **Step 4: Run them and the parity and generic suites**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/obsidianResolve.test.js src/pages/journal-2-0/lib/importer/obsidian.test.js src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js src/pages/journal-2-0/lib/importer/generic.test.js`
Expected: PASS. If a parity fixture now disagrees because the client resolves duplicate basenames the Obsidian way, record it in the commit message for plan A's fixture regeneration. Do not edit the server fixtures here.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/obsidianResolve.js app/src/pages/journal-2-0/lib/importer/obsidianResolve.test.js app/src/pages/journal-2-0/lib/importer/adapters/obsidian.js app/src/pages/journal-2-0/lib/importer/adapters/generic.js app/src/pages/journal-2-0/lib/importer/obsidian.test.js
git commit -m "fix(importer/obsidian): resolve links and images the way Obsidian does; relative, escaped-pipe and note-embed links become note links"
```

---

### Task 9: Notion links to pages missing from the zip

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/importer/adapters/notion.js:285-310` (`resolveReferences`), and `parse()` to build the id map
- Test: `app/src/pages/journal-2-0/lib/importer/notion.test.js`

**Interfaces:**
- Produces:
  - A page link (`.md`/`.html`) whose target is not in the zip: when the last segment carries a 32-hex id (`/ ([0-9a-f]{32})\.(md|html)$/i` after decoding), the href becomes `https://www.notion.so/<id>`; otherwise the anchor is neutralised to text. A dead relative href is never left.
  - An absolute `https://(www.)notion.so/…<32hex>` link whose id is a page **in** the zip → `data-import-link="notion:<id-stripped path>"`, pushed onto `links`. `idToPath: Map<hex, rawPath>` is built once in `parse()` from `NOTION_FILE_RE` matches.

- [ ] **Step 1: Write the failing tests**

```js
it('turns a link to a page missing from the zip into a working notion.so URL', ...)  // [gone](Gone%20<HEX2>.md) -> href https://www.notion.so/<HEX2>
it('keeps a missing link with no page id as text, never a relative href', ...)
it('maps a notion.so URL to a page that is in the zip onto that note', ...)
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/notion.test.js`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run them and confirm they pass**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/notion.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/adapters/notion.js app/src/pages/journal-2-0/lib/importer/notion.test.js
git commit -m "fix(importer/notion): links to pages outside the export open on notion.so, never a dead relative path"
```

---

### Task 10: Server: edit guard, `mode="recover"`, finalize-write stamp

**Files:**
- Modify: `api/services/journal_two/notes.py` (`import_confirm` `:1360-1540`; `update_note` `importMediaPending` branch `:3987-3997`; new helper next to `_body_has_import_placeholder`)
- Modify: `api/routers/journal_two.py:3275-3287` (`notes_import_confirm_endpoint`)
- Test: `api/services/journal_two/test_notes_import.py`

**Interfaces:**
- Produces:
  - `LEGACY_FINALIZE_WINDOW_S = 7200` and `LEGACY_FINALIZE_SLACK_S = 120` (module constants).
  - `_edited_since_import(conn, user_id: str, row: sqlite3.Row) -> bool`: **True means hands off.**
    - `imported_at` missing or unparsable → True.
    - `updated_at <= imported_at` → False.
    - Legacy finalize: the newest mtime of any file under `_ATTACHMENT_ROOT/<user>/notes/<id>/{inline,file}/` is within `LEGACY_FINALIZE_WINDOW_S` after `imported_at`, AND `0 <= updated_at - newest_mtime <= LEGACY_FINALIZE_SLACK_S`, AND no `j2_note_versions` row for the note has `created_at > imported_at` → False.
    - Otherwise → True.
  - `import_confirm(user_id, payload, conn=None, *, guard_edits: bool = False) -> dict`
    - `payload["mode"]` is absent/None or `"recover"`. Anything else → `NoteValidationError('mode must be "recover"')`. `mode == "recover"` implies `guard_edits=True`.
    - When the guard is on and an existing row has `_edited_since_import` True → no write; `{importKey, id}` goes into a new `keptEdited` list.
    - `recover`: an existing, unedited row is written **even when the hash matches and nothing is pending**. Before the UPDATE, call `_maybe_capture_version(conn, id, user_id, <SELECT * row>, force=True)`. The UPDATE is the same column set as the existing `updated` branch **except `folder_id` stays as it is** (the member chose where it lives). `updated_at` = the export's `updatedAt` (as the update path does today) and `imported_at` = now. Reported in a new `recovered` list `{importKey, id, updatedAt}`, never also in `updated`.
    - The response gains `recovered` and `keptEdited` **only when `guard_edits`** (the default call keeps its exact shape; the connector engine calls `import_confirm` without `guard_edits`, so its behaviour is unchanged).
  - Router: `notes_service.import_confirm(user["id"], payload, guard_edits=True)` (file imports never overwrite an edited note, in either mode). A `NoteValidationError` → 400 (existing).
  - `update_note`: when `"importMediaPending" in patch`, also set `imported_at` to the same `_now_iso()` value written to `updated_at`. That makes the importer's own finalize PUT not count as a member edit (the forward fix the legacy rule above compensates for). Compute the timestamp once and reuse it for both columns.

- [ ] **Step 1: Write the failing tests**

```python
def test_recover_rebuilds_an_unedited_note_even_with_an_unchanged_hash(conn): ...
    # confirm A -> hash h; confirm A again mode=recover -> recovered==[A], body rewritten, folder unchanged
def test_recover_never_touches_an_edited_note_and_lists_it(conn): ...
    # confirm, then update_note(title='mine') -> recover -> keptEdited==[A], title still 'mine'
def test_default_file_import_keeps_an_edited_note_when_the_export_changed(conn): ...
    # guard_edits=True, changed body -> keptEdited, body unchanged
def test_engine_call_without_guard_is_unchanged(conn): ...
    # guard_edits default False: response has no recovered/keptEdited keys; edited note updated as before
def test_importer_finalize_put_does_not_count_as_an_edit(conn): ...
    # confirm; update_note(..., {"bodyJson": b, "importMediaPending": False}) -> _edited_since_import False
def test_legacy_finalize_shape_reads_as_unedited(conn, tmp_path, monkeypatch): ...
    # updated_at = imported_at + 600s, a media file with mtime = updated_at - 5s, no version rows -> False
def test_legacy_shape_with_a_later_text_edit_reads_as_edited(conn, ...): ...
    # same plus a j2_note_versions row created_at > imported_at -> True
def test_recover_checkpoints_the_replaced_body_in_version_history(conn): ...   # Review Focus 2
def test_import_confirm_refuses_an_unknown_mode(conn): ...
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `python -m pytest api/services/journal_two/test_notes_import.py -q`
Expected: FAIL (`unexpected keyword argument 'guard_edits'`, plus assertion failures).

- [ ] **Step 3: Implement the service and router changes**

- [ ] **Step 4: Run them, then the neighbouring suites that call `import_confirm`/`update_note`**

Run: `python -m pytest api/services/journal_two/test_notes_import.py api/services/journal_two/test_note_connectors_engine.py tests/test_notes_answer_is_the_committed_row.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/notes.py api/routers/journal_two.py api/services/journal_two/test_notes_import.py
git commit -m "feat(notes-import): file imports never overwrite an edited note; explicit recover mode rebuilds unedited ones"
```

---

### Task 11: Client recover flow and summary

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/importer/confirmBatches.js:79-82` (`confirmBody`)
- Modify: `app/src/pages/journal-2-0/lib/importer/commit.js` (`runImport`)
- Modify: `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx` (preview checkbox, `handleConfirm`, summary step)
- Test: `app/src/pages/journal-2-0/lib/importer/commit.test.js`, `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx`

**Interfaces:**
- Consumes: Task 10's response buckets.
- Produces:
  - `confirmBody({source, destFolderId, mode}, parts)`: adds `"mode":"recover"` only when `mode === 'recover'`. The envelope otherwise stays byte-identical, so the existing size math in `planConfirmBatches` is unaffected. Its envelope byte count must include `mode`: pass the same `{source, destFolderId, mode}` there.
  - `runImport({..., mode})`: `body.recovered` is handled like `updated` (`idByKey`, `toCommit`, `settleNoteWrites`, `importedNoteIds`), counted in `summary.recovered`, outcome `'recovered'`. `body.keptEdited` → `summary.keptEdited.push({name, importKey})`, outcome `'kept_edited'`.
  - Wizard: on the preview step, when `previewCounts.update + previewCounts.unchanged > 0`, a checkbox `data-testid="import-recover-mode"` labelled **"Re-import to recover missing pictures and links"**, with the help line **"Notes you haven't changed since they were imported are rebuilt from this export. Notes you've edited are left exactly as they are."** Off by default; component state only (no persistence). `handleConfirm` passes `mode: recoverMode ? 'recover' : undefined`.
  - Summary step: three sections, each rendered only when non-empty.
    - **"Kept as you edited them"**: one row per `keptEdited` with **"You've edited this note since it was imported, so it was left as it is. Open it beside the export to copy anything across."**
    - **"Couldn't be copied"**: one row per `notices`: note title, name, and `sourceUrl` as a link when present.
    - **"Links not connected yet"**: one row per `unconnectedLinks`: note title and link text, with **"These connect automatically when the note they point to is imported."**
  - The per-folder breakdown (`:526-540`) counts `recovered` as arrived and `kept_edited` as unchanged.

- [ ] **Step 1: Write the failing tests**

```js
// commit.test.js
it('sends mode recover and treats recovered notes like updated ones', ...)  // confirm body JSON.parse(...).mode === 'recover'; recovered note gets its media PUT
it('lists notes kept because the member edited them', ...)
it('the default import sends no mode key', ...)
// ImportWizard.test.jsx
it('offers recover mode only on a re-import and sends it when ticked', ...)
it('shows kept-edited, could-not-copy and not-connected sections from the result', ...)
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/commit.test.js src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement it**

- [ ] **Step 4: Run them, the key-listener census and the confirm-batch tests**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/commit.test.js src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx src/pages/command/keyListenerCensus.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/confirmBatches.js app/src/pages/journal-2-0/lib/importer/commit.js app/src/pages/journal-2-0/lib/importer/commit.test.js app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx app/src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx
git commit -m "feat(import-wizard): re-import to recover, and a report of what was kept, not copied, or not connected"
```

---

### Task 12: §10 corpora rails (messy Evernote, Obsidian, Notion) + the client parity rail stops decoding

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/__fixtures__/corpora/evernote/messy.enex` (synthetic, real-export shape). Notes:
  - a web clip with `<source-url>`, relative + `#` links and a remote `<img>`;
  - nameless resources (`clip-image`, `quote.ashx`, no `<file-name>`);
  - HEIC (`image/heic`) and SVG resources;
  - a `data:` image;
  - `evernote:///` + shard + `/l/` share links to a title in the file, plus one to a missing title, plus two notes sharing one title;
  - bold inside a note link; an image inside a note link; a web link around an image and around a PDF;
  - an unmatched-hash `<en-media>`;
  - bare URLs, plus one inside `<code>`.
- Create: `…/corpora/obsidian/Vault/**`:
  - `.obsidian/app.json` with `attachmentFolderPath: "Files"`;
  - notes with spaces in names, a subfolder note using `![](Files/x.png)`, a table with `[[Other note\|alias]]`, `![[Other note]]`, `[x](../Notes/Other%20note.md)`;
  - duplicate `x.png` in two folders, `![](https://cdn.example.com/r.png)`, a bare URL.
- Create: `…/corpora/notion/Export/**`: a page with a link to a page missing from the export, a `notion.so` URL to a page that is present, a remote image, a bare URL.
- Create: `app/src/pages/journal-2-0/lib/importer/corpora.harness.js` (shared helpers), plus `corpora.evernote.test.js`, `corpora.obsidian.test.js`, `corpora.notion.test.js`.
- Modify: `app/src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js:106-117`. Remove `decodeURIComponent` from `normalizeLinkHref`/`normalizeImageSrc` (spec §10 "fix the two parity rails"; the server generator is plan A's).

**Interfaces:**
- Consumes: everything above. The Obsidian and Notion fixtures are zipped in memory with `fflate.zipSync`, then run through `expandArchives`, so the real intake path is exercised.
- Produces (harness):
  - `async importCorpus(vfiles) -> {docs, puts: Map<noteId, bodyJson>, summary}`: runs `detectAdapter` → `parseImport` → `htmlToNote` → `runImport` against a scripted `fetch`. The script stands in for plan A's server (A1, A2, A6): confirm creates ids; `/images` answers `kind:'file'` for `image/svg+xml` and adds `original` for `image/heic`; `/media/fetch` answers 200 for `cdn.example.com` and 422 `{reason:'fetch_failed'}` otherwise; heal-links answers `unresolved` for `evernote-title:` keys. It also records every multipart `Blob.type` and its bytes.
  - `renderBody(bodyJson) -> HTMLElement`: a read-only `new Editor({extensions: buildExtensions(), content, editable: false})` with `editor.view.dom` returned. `importNotice` is plan A's node: until it is registered in `buildExtensions`, the DOM assertions for notices are `it.todo` gated on `editor.schema.nodes.importNotice`, so the rail goes active the moment plan A lands, not before.

- [ ] **Step 1: Write the failing tests.** One `it` per construct, each asserting on the stored body (`puts`) AND the rendered DOM, never on a normalised copy:

```js
it('web-clip relative link opens the source site', ...)      // stored href 'https://news.example.com/x'; DOM <a href> passes openableLinkHref
it('bare URL is a link, URL in code is not', ...)
it('note link by title is a real internal link', ...)        // stored href /journal?j2tab=notebook&note=<id>; DOM <a href> same string
it('ambiguous title stays text and the summary says so', ...)
it('missing title is a healable placeholder and listed as not connected', ...)
it('nameless web-clip image uploads with its declared type and renders', ...)  // Blob.type 'image/png'; uploaded bytes === resource bytes; DOM <img src> === stored src
it('HEIC renders the converted image and keeps the original as a chip', ...)
it('SVG is kept as a downloadable file', ...)
it('remote image is copied in, never hotlinked', ...)        // no stored src starts with http
it('failed remote image is a notice with the original URL', ...)
it('data: image is uploaded', ...)
it('image inside a note link survives', ...)
it('link around an image and around a PDF survives as a link line', ...)
it('bold inside a note link survives', ...)
it('hash-mismatched image stays in place', ...)
// obsidian: space-named wikilink, escaped pipe, note embed, relative md link, attachment folder, duplicate basename same-folder-first, remote image
// notion: missing page -> notion.so, present notion.so URL -> internal link, remote image copied, bare URL linked
```

- [ ] **Step 2: Run them and confirm they fail where earlier tasks are not yet merged** (expected to pass when Tasks 1–11 are in)

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/corpora.evernote.test.js src/pages/journal-2-0/lib/importer/corpora.obsidian.test.js src/pages/journal-2-0/lib/importer/corpora.notion.test.js src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js`
Expected: PASS for the corpora. `obsidianParity.contract.test.js` FAILS on fixtures that still carry `%20` until plan A regenerates them. That red is the rail working (spec §4: never normalise the difference away). Leave it red and name it in the PR for plan A.

- [ ] **Step 3: Fill any gap a corpus test exposes in the task that owns that code.** Do not fix it in the harness.

- [ ] **Step 4: Run the whole importer directory**

Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/ src/pages/journal-2-0/components/notebook/import/`
Expected: PASS, apart from the named parity reds from Step 2.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/__fixtures__/corpora app/src/pages/journal-2-0/lib/importer/corpora.*.js app/src/pages/journal-2-0/lib/importer/obsidianParity.contract.test.js
git commit -m "test(importer): messy Evernote, Obsidian and Notion corpora checked on the stored note and the rendered DOM"
```

---

### Task 13: Repo rails and bundle check

**Files:** none, unless a rail goes red. In that case the fix goes in the owning task's files.

- [ ] **Step 1: Build, then run the Notebook byte budget**

Run: `cd app && npm run build && cd .. && python tools/notebook_perf_budgets.py --dist app/dist`
Expected: exit 0, and no importer module in the Notebook first-open chunk set. Every new module is reached only through `ImportWizard`'s lazy chain (`NotebookTab.jsx:149` `lazyDialog`) and `await import(...)`.

- [ ] **Step 2: Run the cross-cutting rails by path**

Run: `cd app && npx vitest run src/pages/command/keyListenerCensus.test.js src/lib/swallowedFetch.census.test.js src/noRegexLookbehind.test.js src/components/screener/reachable.test.js src/pages/journal-2-0/lib/tiptap.import.test.js src/pages/journal-2-0/lib/tiptap.linkGuard.test.js`
Expected: PASS.

- [ ] **Step 3: Run the Python import suites once more**

Run: `python -m pytest api/services/journal_two/test_notes_import.py api/services/journal_two/test_note_connectors_engine.py -q`
Expected: PASS.

- [ ] **Step 4: Confirm nothing was committed outside the plan's files**

Run: `git status --short && git log --oneline -15`
Expected: a clean tree; only this plan's commits.

---

## Self-review (done)

- **Spec coverage:**
  - L-3: Task 1, wired for every adapter in Task 3, so ENML, Notion HTML, Keep, Logseq and generic HTML are covered.
  - L-4: Tasks 1 and 3 (relative and `#` against `<source-url>`), Task 8 (`obsidian://`), Task 7 (Evernote deep links).
  - E-4 / E-6 / E-11 / E-12 / E-14: Task 6. E-5 + Q5: Task 7 (placeholder + heal consumed from A5/A6).
  - O-5 / O-8 / O-11 / I-9: Task 8. Notion missing pages: Task 9.
  - I-1, I-5: Tasks 2 and 5. I-6: Tasks 2 and 3. I-7: Tasks 4 and 5, with the `<img>`-inside-`evernote:///` case in Task 6.
  - Q1: Tasks 10 and 11. §10 client corpora: Task 12.
  - Not in this plan: the Q1 Notebook-wide notice for members with past losses (it needs the §9 repair's server-side detection, so it is plan A's / the repair plan's). §5.6 polish.
- **Types:** `MediaItem`/`MediaResult` are defined once (file-structure block, Task 5). `rewriteBody`'s `mediaResults` shape matches what `storeMediaItem` returns. `keptLinks` (Task 4) feeds `unconnectedLinks` (Task 5). The `recovered`/`keptEdited` names are the same in Tasks 10 and 11.
- **Proportion:** signatures, rules and test names are given; bodies are left to the implementer except the `data:` regex and the resolver tie order, which the tests alone would not fix.
