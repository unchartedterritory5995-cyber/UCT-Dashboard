# Note connectors: fidelity, Evernote live sync, Sync now, leftovers — design

Date: 2026-11-01. Owner ask (verbatim intent): "there were some issues with links and clickable
websites and images transferring over when we did Obsidian and Evernote and Notion. So we should
focus there" + a live Evernote connector + Sync now picking up remote deletes + the small connector
leftovers + "anything else that can be improved and perfected for our system for this". Owner is
willing to pay for an Evernote plan and will do the clicks/sign-ins that only a person can do.

## 1. Why

Members move years of notes into the UCT Notebook from Notion, Obsidian and Evernote. The 9/5
certification (`docs/notebook-connectors/60-user-reliability-certification.md`) passed on small, tidy
fixtures. A read-only investigation on master `fa1aac7a2f` (2026-11-01), running the real converters
on realistic inputs, found that on real libraries links come over dead or unclickable, images
silently vanish, and in one case a sync overwrites the member's own edits. A migration that quietly
loses pictures and links is the product failing quietly: the member doesn't notice until they need
the note.

Success = a member's real library arrives with every link that pointed somewhere still pointing
there (and clickable), every image visible, every file kept, and nothing ever silently dropped. When
something truly cannot come over, the note says so in place and the member can see a list.

## 2. Goals

G1. **Never overwrite a member's edit** (hotfix, shipped separately first on branch
`fix/note-sync-never-overwrites-edits`).
G2. **Links:** every link survives, is clickable (mouse, touch, read-only and shared/published
pages), and links between imported notes are real note links (backlinks + graph).
G3. **Images and files:** nothing silently dropped. Every image renders from UCT storage; every
non-image file is kept as a downloadable attachment.
G4. **Evernote live sync** as a connector provider, like Notion's, if Evernote's service allows it.
G5. **Sync now** shows remote deletions without waiting for the 01:47 ET nightly pass.
G6. **The five leftovers** (§8).
G7. **Already-imported notes get repaired**, not just future imports.
G8. **Rails that would have caught all of this**: messy real-world corpora per provider.

## 3. Non-goals

- Dropbox / OneNote / OneDrive app registration (owner: not now). Their code paths benefit from the
  shared fixes but are not separately activated or live-gated.
- Two-way sync (standing ruling D18: no write-back to the source app).
- Obsidian callout/footnote/`|300` width fidelity is welcome (§5.6) but not required.
- No change to the conflict policy itself (edited + remote changed ⇒ "(synced copy)" sibling).

## 4. Anti-goals (failure even if it "works")

- Any path that drops a member's content without a visible marker in the note.
- A hotlinked image that works today and breaks next month (store our own copy).
- A repair pass that rewrites a note the member has edited since import, or bumps `updated_at`
  (engine bookkeeping writes must stay timestamp-neutral, see `engine.py`
  `_write_*_preserving_updated_at`).
- A fix that passes only because a rail normalises away the difference (the Obsidian parity rails
  `obsidian_parity_fixtures_gen.py:115-124` and `obsidianParity.contract.test.js` URL-decode hrefs
  before comparing — that is how the space-in-name bug survived).
- Repeated guards (one guard, mutation-proved, per invariant).

## 5. What is broken today (confirmed by running code) and the required outcome

Paths: **S** = server connectors (`api/services/journal_two/note_connectors/**`), **C** = client
file importer (`app/src/pages/journal-2-0/lib/importer/**`), **P** = Obsidian plugin
(`obsidian-plugin/src/**`). Investigation repros live in the session scratchpad
(`.../scratchpad/{notion,obsidian,evernote}/`); they are throwaway, not deliverables.

### 5.1 Data safety (G1)
- S `engine.py` (pre-fix ~1532) + `notes.py:1472`: an edited note with an unchanged remote went to
  `import_confirm`, which re-writes any note whose `import_media_pending` is set (audit B5), and a
  note with a forever-unresolvable link stays pending forever ⇒ member edit overwritten every sync,
  media re-downloaded every sync. **Fixed on the hotfix branch** (edited + unchanged ⇒ skipped).
- Remaining: a note that is NOT edited but has an unresolvable link still re-imports and re-downloads
  media every pass (waste, inflated "Updated" counts). Required: pending must mean "something can
  still be resolved"; a link whose target is known-unreachable (not shared / database / trashed /
  missing after the final pass) must stop holding the note pending, while a link to a note that may
  arrive later must still heal when it arrives (§5.2 S-4).

### 5.2 Links (G2)
Cross-cutting:
- L-1 `linkClickOpen.js:77-90` `openableLinkHref` refuses `/journal…` hrefs, so resolved internal
  links (`/journal?j2tab=notebook&note=<id>`, written by `rewrite.py` and `commit.js:84`) cannot be
  opened by Ctrl+click, touch re-tap, or on read-only/shared pages. Its own test pins the refusal.
  Required: a resolved internal link opens the note in-app (same tab, SPA navigation) everywhere a
  link opens; on a public/shared page it must not leak a private note (render text, or the shared
  copy if that note is also shared — builder's choice, but never a private id the viewer can't open).
- L-2 Resolved internal links are Link MARKS, so they never reach `j2_note_links` (no backlinks, no
  graph; `notes.py:535-544`). Required: internal links count as note links. The editor already has a
  `noteLink` node (`lib/noteLinkNode`); converting to it vs. teaching the projection to read
  internal-href marks is the builder's call — but the member's display text (Obsidian alias, Notion
  link text) must be preserved exactly.
- L-3 Bare URLs in text are never linkified on any import path: server `mddoc.py:61` is commonmark
  without linkify; Notion rich text, Evernote text and Roam/Craft text likewise; TipTap `autolink`
  (`tiptap.js:264`) only acts on typing. The client zip path (`generic.js:16`) already uses
  `linkify:true`. Required: `https://…`, `http://…`, `www.…` (and `mailto:`) in plain text become
  links on every path, never inside code marks/blocks, and with trailing punctuation handled the way
  linkify-it does.
- L-4 Link scheme handling: unsafe schemes (`javascript:`, `data:`, `vbscript:`, `file:`) stay
  stripped to text (already true); app deep links that mean nothing in UCT (`evernote:`, `notion:`,
  `obsidian:`, `onenote:`) are resolved to the imported note when possible (below), else text.
  Relative and `#fragment` links from web clips must not resolve against uctintelligence.com:
  resolve against the clip's source URL when known (Evernote `<source-url>`), else keep as text.

Notion (S):
- N-4 `notion_blocks.py:234-239` `link_mention`, `link_preview`, `database` mentions become plain
  text, `href` ignored ⇒ must be links (to the URL; a database mention to its imported note if any).
- N-5 `notion_blocks.py:243-245` text links into the same workspace (`/<32hex>`,
  `https://www.notion.so/…-<id>`) are copied raw (dead) ⇒ must map to the imported UCT note (same
  resolution as page mentions); unresolvable ⇒ keep a working notion.so URL, never a relative href.
- N-8 `notion_blocks.py:129-177, 346-376` database tables (≤50 rows) flatten: `url` cells plain text,
  rich-text hrefs dropped, `files` cells lose the file, row titles not linked. ⇒ url cells clickable,
  hrefs kept, files rehosted (image inline / file chip), row titles link to row notes where imported.
- N-9 (polish) `link_to_page` labelled "Linked page" ⇒ target's title; bookmark/embed/link_preview ⇒
  the editor's `linkPreview`/`webEmbed` nodes where safe, else a plain link (current).

Obsidian (S + C):
- O-1 S `providers/obsidian.py:385-393` + `mddoc.py:628-631`: wikilink targets with a space (Obsidian's
  default naming) never resolve — markdown-it percent-encodes the destination, so the key
  `…/Target%20Note.md` ≠ import_key `…/Target Note.md`. Must resolve (decode once, at one place).
- O-4 S `obsidian.py:390`: an unresolved wikilink is written as plain text, so a note created later
  never heals the link. ⇒ keep a resolvable placeholder; heal when the target arrives (this is also
  the "may still resolve" case of §5.1).
- O-5 S+C relative markdown links `[x](Other%20note.md)`, `[x](../Notes/Other.md)` stay dead
  relative hrefs (`generic.js:336` defers to the Obsidian adapter, which never does it) ⇒ resolve to
  the note.
- O-8 S+C `| [[Other note\|alias]] |` (Obsidian's escaped pipe in tables) ⇒ target read as
  `Other note\` ⇒ must resolve.
- O-11 C `obsidian.js:268` `![[Other note]]` uploads the raw `.md` as a file chip ⇒ should be a note
  link (or transclusion, builder's call); S makes it a link, which then hit O-1.
- Polish: `#Heading`/`#^block` anchors dropped and display text keeps `Other note#Heading`; server
  note-embed text includes `.md`; server callouts keep literal `[!note]`; footnotes literal `[^1]`;
  raw `<img>`/`<a>` HTML shown as text; duplicate basenames resolve to first seen (Obsidian resolves
  shortest-path / same-folder first).

Evernote (C):
- E-5 `evernote.js:298` (+ `links: []` hardcoded at `:169`) note-to-note links
  (`evernote:///view/…`, `https://www.evernote.com/shard/…/nl/…/<guid>`, `/l/…` share links) become
  plain text or stay pointing at Evernote. .enex carries no note guid, so resolve by **link text ==
  imported note title** within the same import (Evernote fills the link text with the title when
  the link is made); ambiguous (duplicate titles) or renamed targets ⇒ plain text, and the import
  report lists them. With the live connector (§6) guids exist and must be used instead.
- E-4/E-6 the same `textContent` replacement erases an `<img>`/`<en-media>` inside an internal link
  (image lost silently, orphan uploaded, no failure reported) and flattens bold/italic in the link ⇒
  keep children and marks.
- E-11 a link wrapped around an image/attachment loses the link ⇒ keep it (clickable image, or a
  link line next to it — builder's call).
- E-12 `<note-attributes><source-url>` discarded ⇒ keep the web clip's source URL on the note
  (visible, clickable) and use it to resolve relative links (L-4).
- E-14 (cosmetic) an image whose hash matches no resource drops to the end as a chip; inline images
  split paragraphs.

### 5.3 Images and files (G3)
Rules for every path (S and C), one shared policy, one place each side:
- I-1 **Type from content, not file name.** C `commit.js:229/241` picks MIME from the extension and
  ignores Evernote's `<mime>`, so web-clip images named `clip-image`/`quote.ashx` upload as
  `application/octet-stream` and are rejected. S compares raw Content-Type exactly
  (`providers/notion.py:422` vs `notes.py:120/126`) so `image/png; charset=binary` and
  `binary/octet-stream` are rejected. ⇒ trust declared MIME parameters-stripped, and sniff magic
  bytes server-side as the authority.
- I-2 **Convert, don't refuse.** HEIC/HEIF, TIFF, BMP, AVIF ⇒ converted server-side to JPEG (photos)
  or PNG (alpha) and shown inline; originals kept as an attachment when conversion is lossy-format
  (HEIC) so nothing is thrown away. SVG ⇒ never inline-rendered from member content as-is (script
  risk); rasterise to PNG if a safe rasteriser is available, else keep as a downloadable file.
- I-3 **Oversize:** images > 5 MB (`notes.py:120-137` cap) are downscaled server-side to fit, original
  kept as an attachment if it fits the 25 MB attachment cap; beyond that, a visible "too large"
  marker with name and size.
- I-4 **Everything else is a file, never dropped:** video, audio, pptx, mov, wav, zip… ⇒ attachment
  chip up to the attachment cap; over cap ⇒ visible marker (name, size, and a link to the original
  when there is one). Notion YouTube/Vimeo video blocks ⇒ an embed/link to the video, never a
  download of the YouTube HTML page (`notion_blocks.py:779`).
- I-5 **Hotlinks are copied in.** Remote `<img src="https://…">` (Evernote web clips, Obsidian
  `![](https://…)`, C lane currently keeps hotlinks): download and rehost; `http://` allowed for the
  DOWNLOAD (server-side fetch through the existing SSRF guard), always served over https; follow
  redirects (S `fetch_media` `notion.py:415` doesn't); on failure keep a visible marker WITH the
  original URL as a clickable link (the member can still reach it), never an empty paragraph.
- I-6 `data:` URI images (`tiptap.js:238` `allowBase64:false` drops them) ⇒ decoded and uploaded.
- I-7 **Failed media is visible and retried.** Today S `rewrite.py:111-128` + `engine.py:1150-1179`
  remove a failed image with no trace, pending=0, never retried. Required: a visible in-note marker
  ("Image couldn't be copied: name — retrying on next sync" / "— open original"), the note stays
  eligible for a media retry on later syncs (bounded: stop retrying after N attempts with a final
  marker), and the source card / import result lists such notes.
- I-8 **Obsidian attachments are sent at all.** P `vault-source.ts:15` sends only markdown
  (`getMarkdownFiles`, `cachedRead`) and the manifest guard (I3) refuses unstaged paths, so every
  `![[image.png]]` becomes the literal text `image.png` and `![](attachments/x.png)` is dropped
  (`obsidian.py:722`). Required: the plugin uploads the binaries a synced note references (embed or
  markdown image/link), resolved the way Obsidian resolves them (`attachmentFolderPath` in
  `.obsidian/app.json`, shortest-path, same-folder-first), deduped by content hash, size-capped, with
  the server accepting them through the existing staged-push protocol (extended). A new plugin
  release (bare-version tag, reproducible build — Obsidian's review rebuilds byte-for-byte) and the
  community listing's "Check for new releases" are part of done. Older plugin versions must keep
  working (text-only) and the member is told an update brings images.
- I-9 C path resolution for Obsidian markdown images relative to vault root / shortest path
  (`generic.js:318`) and `attachmentFolderPath` ⇒ resolve like Obsidian.

### 5.6 Polish (do if cheap, after the above)
Obsidian `|300` image width; `#Heading` anchors scroll to the heading; callouts → native callout;
footnotes; Notion captions → `ImageCaption`; Evernote `<source-url>` shown as a header line.

## 6. Evernote live sync (G4)

Facts (official pages read 2026-11-01): Evernote's hosted MCP server `https://mcp.evernote.com/mcp`
is **beta**, **paid plans only** (Free/Basic excluded), OAuth 2.0 against `accounts.evernote.com`
with **Dynamic Client Registration only** (RFC 7591; HTTPS redirect URIs on any host allowed with
approval on the consent screen), 28 tools incl. `search_notes` ("Evernote's search grammar —
notebook, tag, and date filters"), `get_note` ("full content, tags, and attachments"),
`get_attachment`, `search_notebooks`; per-minute rate limits (numbers unpublished); per-tool
parameter pages 404; nothing stated about refresh tokens, enumeration of a whole library, or
unattended/scheduled use. Classic EDAM API is deprecated.

Phase E0 — **probe (gate, owner present)**: owner buys/enables an eligible Evernote plan and signs in.
From a server-side client (a throwaway script, then the product), register via DCR with the
production callback `https://uctintelligence.com/api/j2/notes/connectors/evernote/callback`, consent
once, call `tools/list` and record the full JSON schemas, then measure: can `search_notes` enumerate
every note (paging/offset, total count, `updated:` filter)? what `get_note` returns (ENML/HTML/
markdown; guids; note-link format)? attachment bytes + mime + hash? refresh-token presence and
lifetime? observed rate limits? Record everything in `docs/notebook-connectors/evernote-mcp-probe.md`
with the raw `tools/list` output. Check Evernote's terms for automated use; if unclear, the owner
emails Evernote support (draft provided).

Decision rule after E0:
- **Go** if: whole-library enumeration + an incremental filter (date or equivalent) + attachment
  bytes + a refresh token (or a token that lasts long enough for nightly sync with silent refresh).
  Then E1: `providers/evernote.py` behind the registry (the only provider door), using the shared
  engine, cursor = last-updated watermark, delete detection via full enumeration (nightly / §7),
  ENML→TipTap via the C converter's rules ported server-side or a shared spec + parity fixtures
  (one behaviour, two implementations pinned against each other), note links resolved by guid,
  tile in ConnectedAppsCard, flag `NOTE_SYNC_EVERNOTE_ENABLED` (ledgered, dark until live-gated
  against the owner's real account with real messy notes).
- **No-go** on any of those: record why, keep the tile honest ("Import an .enex export"), and the
  .enex importer fixes in §5 are the Evernote product. Re-probe trigger recorded (e.g. Evernote ends
  beta).
- Free-plan members can never use the live connector (Evernote's rule); the tile must say so and
  offer the .enex import.

## 7. Sync now shows remote deletions (G5)

Today Sync now is incremental (`useNoteConnectors.js::syncSource` sends no `full`; router default
`full=False`; `_run_delete_detection` only runs `if full:`), so remote deletes show only after the
01:47 ET pass. Required: after a member deletes in the source app and presses Sync now, the note is
marked removed (tagged `source-deleted`, never erased — unchanged policy) on that press for any
provider that can list deletions explicitly (Notion trash sweep severs in one pass), and the card
says plainly when a deletion is pending confirmation (2-strike rule for hard deletes). Keep the
<50% enumeration refuse guard and the 20%/pass cap. Cost control: a manual full pass is rate-limited
per source (builder picks, e.g. once per 10 min; otherwise incremental + the existing message).
Watch Notion's 30–60 s search-index lag (certification §): a just-trashed page can be missing from
the enumeration; the guard must not fire on that.

## 8. Leftovers (G6), all still present on master
1. Busy source: engine returns `{"status":"busy"}` (`engine.py:308`), router passes it as HTTP 200
   ⇒ Sync now silently no-ops and holds a worker through the retry ladder. ⇒ fast 409 + "a sync is
   already running" on the card.
2. Card computes `notesSkipped` (`useNoteConnectors.js:102`) but `SourceRow.jsx` never renders it.
3. `DropboxFolderPicker` rapid double navigation race (no request-id guard).
4. Cross-device OAuth (start on one device, finish on another) 400s with a generic error ⇒ say what
   happened and how to finish.
5. `GET …/sources/{id}/log` returns snake_case rows (no consumer yet) ⇒ camelCase like the rest, or
   delete the route if nothing will consume it (builder's call; prefer camelCase + render the last
   few log rows on the card as the "what didn't come over" list from §5.3 I-7).
Also from the certification's known limitations: the Obsidian plugin's Server URL field is
unvalidated (opaque "Invalid URL") ⇒ validate with a clear message (ship in the §5.3 I-8 release).

## 9. Repair of already-imported notes (G7)

Connector sources re-sync, but an unchanged remote is skipped by hash, so fixes would never reach
existing notes. Required: a one-time, per-member, resumable repair that re-runs conversion for
imported notes whose stored body carries a known-broken shape (dead `import-link://`, `%20`-keyed
Obsidian links, relative note hrefs, plain-text bare URLs, hotlinked images, missing Obsidian
images), using the source when reachable (connector) or the stored body when not (file imports:
linkify, link resolution by stored keys). **Never touches a note edited since import** (those get
nothing, or a non-destructive suggestion — builder's call); timestamp-neutral; logged; dry-run mode
with counts first; production run only after the dry-run numbers are reviewed. Obsidian images
arrive after the member updates the plugin (the plugin must re-send attachments for already-synced
notes once).

## 10. Rails (G8)
- Messy real-world corpora per provider, committed as fixtures (synthetic but shaped like real
  exports: Evernote web clips with nameless resources, HEIC, remote images, data: URIs, internal
  links; a Notion workspace JSON dump with mentions, databases, files, videos, unshared targets; an
  Obsidian vault with spaces, attachments folder, tables with escaped pipes, embeds, later-created
  targets). One end-to-end assertion per construct on the stored document AND the rendered DOM
  (clickable `<a href>` that the editor's open-link path accepts; `<img>` that decodes with correct
  natural size), never on a normalised copy.
- Fix the two parity rails that decode hrefs before comparing.
- Live gates (owner sign-in where needed): Notion (owner's existing workspace, add messy pages),
  Obsidian (real vault + updated plugin against production), Evernote (live connector if Go, else a
  real .enex export from the paid account) — each with the certification's method: create, verify
  bytes + render, round-trip export, clean up residue.

## 11. Constraints
- Master is production (Railway deploys `production`; standing GO to deploy when ready, report
  member impact after). PRs; the owner merges where the classifier blocks `gh pr merge`.
- New Python deps (e.g. `pillow-heif` for HEIC) change `requirements.txt` ⇒ flow-worker watched ⇒
  ship needs the owner-only `UCT_FLOW_OVERRIDE` step, outside 9:30–16:00 ET.
- Notebook first-open byte budget and existing rails (key-listener census, persistence census,
  TERM-033/063/066 ratchets) must stay green; new client code lazy where possible.
- Heavy jobs (repair pass over all members) never on the prod pod's request path; batched, bounded,
  and `heavy_lock`-aware if run from the box.
- Classifier-blocked actions (production reads via ssh, railway var sets, merges) go to the owner;
  never routed around.
- Member content rules: no member data copied off production; probes and gates use the owner's own
  accounts or the synthetic accounts.

## 12. Decided (owner) vs my calls
Owner decided: scope = §5–§10 all of it; Evernote live sync wanted and owner will pay + click;
Dropbox/MS Graph registration out of scope.
My calls (owner may override): edited+unchanged ⇒ skip (hotfix); convert HEIC/TIFF/BMP/AVIF rather
than attach-only, originals kept; SVG never inline as-is; hotlinks copied in; title-matching for
.enex note links; Sync now manual full pass rate-limited; repair never touches edited notes; order
of work (§13).

## 13. Order
1. Hotfix G1 (in flight) → PR.
2. Shared media policy + link fixes on the server path (S), with the corpora rails.
3. Client importer (C) same rules + Evernote .enex fixes.
4. Obsidian plugin release (P) + server attachment intake.
5. Sync now + leftovers.
6. Evernote probe E0 (owner present) → E1 if Go.
7. Repair pass (dry run → review → run).
8. Live gates, docs, certification addendum.

## 14. Left to the builder
Internal representation of note links (§5.2 L-2); exact marker copy/visuals; retry counts and
intervals; manual full-pass rate limit; how a shared page renders a private-note link; whether
embeds use `linkPreview`/`webEmbed`; module boundaries; test layout.

## 15. Builder-check answers (all my calls, owner may override)

Q1 — **Past FILE imports (.enex / Notion zip / Obsidian zip) cannot get lost images back from the
stored body.** Decision: (a) the repair (§9) fixes links on stored bodies and inserts a visible
"image missing from the original import" marker where a dropped image is detectable (empty image
nodes, orphaned uploads, failed-upload records); (b) a **"Re-import to recover"** flow: the member
re-uploads the same export; notes match by `import_key`; an UNEDITED note is updated in place even
though its hash is unchanged (a new explicit re-import mode, never the default import path); an
EDITED note is never touched (it gets a suggestion line in the import report). The Notebook shows
one notice to members whose past imports have detectable losses, pointing at the flow.

Q2 — **Storage.** Per-member cap on imported media: **2 GB** (constant, env-overridable), counted
from the existing attachment rows; plus the existing whole-volume headroom guard. Keep-originals is
conditional: HEIC originals are kept (lossy conversion), oversize/TIFF/BMP originals are NOT kept
when the converted copy exists. When either cap refuses mid-import: the note still imports, the item
gets the visible marker ("not copied: storage limit"), the import report lists it, and it is retried
on later syncs only after space frees (never a failed whole import).

Q3 — **.enex notes before the live Evernote connector.** On first live sync, adopt existing
Evernote-file notes: match by exact title + created timestamp (minute precision), content hash as a
tie-break; ambiguous matches are not adopted. An adopted note is re-keyed to the live key. Unedited ⇒
becomes a normal synced note. Edited ⇒ re-keyed but the G1 / conflict rules apply (remote changed ⇒
"(synced copy)" sibling; unchanged ⇒ left alone). Non-matches import as new notes. The connect screen
tells the member this will happen.

Q4 — **Sync now and the 2-strike rule.** The safety rule does not change. A manual full pass is a
real strike. One press: explicit trash lists (Notion) sever immediately; enumeration-based providers
record strike 1 and the card says "N notes look removed in <app>; confirming on the next check".
A second manual full pass counts as strike 2 only if it is at least 10 minutes after strike 1
(beyond Notion-style index lag); otherwise the nightly pass confirms. The <50% refuse guard and the
20%/pass cap stay.

Q5 — **.enex note links across imports.** Resolution matches titles across the current import AND
notes already in the member's notebook that came from Evernote imports. Unresolved ones are stored
as a resolvable placeholder (the O-4 mechanism, server-side), and a later import heals them. Under
the §5.1 meaning of pending, these placeholders do NOT make the note re-import; they are healed by
the link pass when a matching note appears.
