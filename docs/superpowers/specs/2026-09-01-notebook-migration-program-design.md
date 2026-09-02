# Notebook Migration Program — Notion, Evernote, Obsidian

**Date:** 2026-09-01
**Status:** design, pre-implementation
**Supersedes (partially):** `2026-08-11-note-connectors-design.md` §1 Evernote verdict, §10 deferred waves

---

## 1. The goal, stated plainly

The owner's goal is not "support imports." It is: **a member moves their entire note library to UCT Intelligence and stops using the app they came from.**

That distinction drives every decision below. Mirroring someone's Notion workspace into our Notebook is not the win — it is the *bridge*. The win is the day they stop opening Notion. So this program is organised around three questions, in order:

1. **Can they get here?** (connectors — the transfer)
2. **Does it survive the trip?** (fidelity + the scale regime)
3. **Is there a reason to stay?** (the switch)

Most of the industry's "import from X" features stop after question 1 and wonder why retention is flat.

### 1.1 The switch is already designed — and shipped

The sync engine's conflict policy, shipped 2026-08-12, is a one-way ratchet: while a synced note is untouched it updates in place from the remote; **the moment the member edits it in UCT, `imported_at` freezes and all future remote changes fork to a `{key}#remote` "(synced copy)" forever.** The original becomes user-owned permanently.

Read as a migration mechanism rather than a conflict rule, that is exactly the behaviour we want. Nobody is asked to commit, declare a cutover, or trust us with a one-way export. They connect, they keep working in Notion, and then one day they fix a typo *here* — and that note has quietly changed hands. Migration happens per-note, reversibly-feeling, without a decision.

**Do not "improve" this into a merge UX without re-reading this section.** The apparent bug (why can't I edit both sides?) is the feature.

---

## 2. Where we actually are

Derived from `origin/master` and the live Railway `web` service on 2026-09-01 — not from memory.

### 2.1 Shipped and live

| Piece | State |
|---|---|
| Notebook (Journal 2.0) | Live. TipTap editor, nested folders, tags, ticker, hero image, tables, task lists, attachment chips, internal links, **backlinks** (`useNoteBacklinks.js`), templates (`TemplatePicker`), capture inbox, video timestamps/rails |
| **Live embeds in notes** | `ChartEmbed`, `BreadthEmbed`, `ScannerEmbed`, `NewsEmbed`, `WatchlistEmbed`, `FundamentalsEmbed`, `CalendarEmbed`, `AlertsEmbed`, `ThemesEmbed`, `AiSearchEmbed` — via `WidgetPalette` / slash menu |
| File importer | Live. Notion / Obsidian / Evernote(.enex) / generic, auto-detect, preview, transactional confirm, media+link phase, re-import by `import_key` |
| Sync engine | Live. Cursor sync, per-batch confirm+media, conflict fork, delete detection (2-strike `miss_streak`), broken-source recovery |
| Roam, Craft connectors | **LIVE in production** — token paste, no vendor registration |

### 2.2 Built but dark

`NOTE_SYNC_ENABLED=1` and `NOTE_ENCRYPTION_KEY` are set on Railway `web`. **Nothing else is.** So:

| Provider | Code | Blocker |
|---|---|---|
| Notion | complete | `NOTION_CLIENT_ID/SECRET` unset |
| Dropbox | complete | **dropped by owner 2026-09-01** |
| OneNote / OneDrive | complete | **dropped by owner 2026-09-01** |

Dropbox and OneDrive were Obsidian's only doors. Cutting them is a deliberate strategic choice — cloud-storage middlemen are not the integration members recognise — but it means **Obsidian now needs a door built from scratch** (§7).

### 2.3 The Notion blocker is not what the record said

The 2026-08-12 note records "both consoles were logged OUT." That is wrong, and re-deriving it would waste another session.

The account **is** authenticated at `app.notion.com/developers/connections`. The New-connection dialog was filled correctly — OAuth, any workspace, redirect URI derived from `oauth._redirect_uri()` and the live `DASHBOARD_URL` — and **`Create connection` (a `DIV[role=button]`) stayed `aria-disabled=true`**, including in Access-token mode, which rules out an OAuth-eligibility cause. The console throws `TypeError: Cannot read properties of undefined (reading 'getSpaceId')`, the sidebar never leaves skeleton state, and `app.notion.com` redirects to `/onboarding`.

**The account has never created a workspace.** A connection must attach to a space; there is no space; the button can never enable. Also note: Notion renamed integrations → **Connections**, and `notion.so/my-integrations` now redirects.

### 2.4 The Evernote verdict was wrong

`2026-08-11-note-connectors-design.md` §1 says: *"**Evernote** — connector NOT viable (API keys suspended, program deprecated). The shipped `.enex` importer is the permanent answer."*

That was true of **EDAM only**. It has been replaced, and the replacement removes the exact blocker:

- Evernote hosts a **remote MCP server** at `https://mcp.evernote.com/mcp`.
- Auth is **OAuth 2.0** against `accounts.evernote.com` with **Dynamic Client Registration** — verbatim: *"Clients that support OAuth Dynamic Client Registration connect with no manual setup — you don't create an Evernote app or paste credentials."* The 5-business-day manual approval queue that killed this in August **no longer exists**.
- 28 tools, including everything the engine needs: `search_notes`, `semantic_search`, `get_note`, `search_notebooks`, `get_attachment`.
- **In beta:** *"Behavior, tools, and supported clients may change."*

The old §1 line must be struck when this program lands, or it will keep retiring the search (see `lesson_a_premise_that_says_nothing_to_find_retires_the_search`).

---

## 3. Goals and non-goals

**Goals**

1. Notion, Evernote and Obsidian each have a working door that a member can walk through unaided.
2. A member arriving with thousands of notes gets a Notebook that stays usable at that size.
3. The features a migrant will *immediately miss* exist before we invite them.
4. Every wave is independently shippable and independently reversible.

**Non-goals**

- Two-way sync (writing member edits back to Notion/Evernote/Obsidian). Explicitly out — it fights §1.1, doubles the failure surface, and no competitor's users ask for it. The ratchet is the design.
- Merge-grade conflict UX. Deferred, as in the original design.
- Google Drive (CASA ~$3–5K/yr), Apple Notes helper, Keep. Unchanged deferrals.
- Dropbox / OneDrive / OneNote. Built, dark, and now deliberately shelved. **Do not delete the code** — it is byte-identical-safe and costs nothing dark.

---

## 4. Wave 0 — the scale regime (prerequisite, not polish)

**This is the wave most likely to be skipped and most likely to cause the visible failure.**

Every part of the Notebook was built and tuned for the load a person generates by hand: dozens of notes, a handful of folders, a readable tag cloud. Migration does not add a feature — **it multiplies the size of everything at once**, on the first day, for the most motivated users we have.

An Evernote refugee is precisely the person with 4,000 notes and a decade of attachments. They are the highest-intent migrant and they will hit every ceiling simultaneously.

### 4.1 Search is a full table scan

`list_notes()` filters with a leading-wildcard `LIKE` over `lower(title)` and `lower(body_plain)`. A leading wildcard cannot use an index, so every keystroke scans every note body for that user — on the **single-replica web pod that also serves 20+ SQLite DBs**.

It is also *featureless*: no ranking, no operators, no phrase match. Evernote and Notion users arrive with muscle memory for `notebook:`, quoted phrases, and relevance ordering. Falling back to substring search is a visible downgrade at the exact moment we are asking for their trust.

**Change:** add an **FTS5 virtual table** over `(title, body_plain)`, written in the same transaction as the `j2_notes` write. There is exactly one writer path — `extract_plain_text()` already computes `body_plain`, and the FTS write belongs beside it. Search switches to FTS5 with BM25 ranking, falling back to the current `LIKE` only when a query cannot be parsed.

⛔ `body_plain` stays authoritative. The FTS table is a derived index, rebuildable from `body_plain`, never written independently — otherwise it becomes a second authority over one value.

### 4.2 Attachments land on the shared volume

`_ATTACHMENT_ROOT` (from `attachment_root.py`) is the Railway volume — chosen deliberately, because `<repo>/data/j2_attachments` was ephemeral and every redeploy wiped every note image. Per-image cap is 5 MB; the file allowlist also admits PDF, zip, docx, xlsx, mp3 and mp4.

A single migrated library can therefore write a large number of files onto the same volume holding 20+ SQLite DBs, on a pod with one replica and `MALLOC_ARENA_MAX=2`.

**Change:** before any connector is opened to members, *measure* — volume capacity, current free space, and bytes-per-note across a real migrated library. Then set a per-user import media budget and a global headroom guard, and decide whether note media moves to R2 (an `uct-bars-snapshots` bucket already exists, so credentials and pattern are proven).

⛔ **No budget number is written in this spec.** It is a forecast until derived from a real library. The wave's deliverable is the measurement *and then* the guard, in that order.

### 4.3 The surfaces that render the library

- **Archive list** — verify it virtualizes at thousands of cards. `FrozenList` exists; confirm whether `NotebookTab` actually routes through it or renders the full set.
- **Folder sidebar** — Evernote stacks and Notion page trees produce far deeper and wider trees than hand-made folders.
- **Tag cloud** — a decade of Evernote tags is not a cloud, it is a wall. Needs a cap plus search.

### 4.4 Ingest concurrency

The engine batches with per-batch confirm and a final link pass, ticking at `:23` with a nightly full pass at `01:47` ET. What it has never seen is several members running first-time full-library imports simultaneously on one pod. Wave 0 sets a concurrency ceiling for *initial* syncs, distinct from incremental ticks, so a launch does not become an outage.

**Wave 0 gate:** existing suites stay green, plus a seeded large-library fixture (generated, not borrowed) proving search latency and list rendering hold at scale, with the measured numbers recorded in the ledger.

---

## 5. Wave 1 — Notion activation

Almost no code. The connector is complete: OAuth with lock-guarded refresh rotation, `search` enumeration at 100/page, block traversal recursing `has_children`, child-database to table conversion, media fetched inside the 1-hour signed-URL window with 403 re-fetch, incremental search on `last_edited_time` with a 2-minute overlap, trash-sweep deletion, self-imposed 3 rps.

**Blocked on one human step: the owner must finish Notion onboarding so the account has a workspace** (§2.3).

Then:

1. Create the connection at `app.notion.com/developers/connections` — **OAuth**, installable in *any workspace* (members connect their own), redirect URI `https://uctintelligence.com/api/j2/notes/connectors/notion/callback` (derived from `DASHBOARD_URL`; override via `NOTION_REDIRECT_URI`).
2. Set `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` on Railway `web`, then **redeploy** — a variables set only *stages*; it does not restart the process.
3. Verify by artifact — health uptime reset, then the Notion tile present in the served Settings chunk. Not by assuming the deploy worked.

**Activation gates (owed from the original design, still not optional):** validate `in_trash` behaviour on a real workspace; confirm pagination truncation cannot be mistaken for deletion; measure the nightly `list_deleted` API cost.

**Risk carried forward:** this connector was written in August against the API as it then was. Notion has since renamed integrations to Connections and shipped a data-source model. Wave 1 must re-verify `search` and block traversal against the current API version before it is called done — a green suite proves our code unchanged, not the vendor unchanged.

---

## 6. Wave 2 — Evernote via MCP

### 6.1 The probe gate (cheap, and it comes first)

Everything below is conditional. The docs publish tool **names** but no **parameters**, and two unknowns decide whether this is a sync connector or a better importer:

1. **Can it enumerate?** If `search_notes` accepts Evernote's classic query grammar (`updated:YYYYMMDD`, `notebook:X`) we get the incremental cursor for free and whole-library enumeration is real. If it is semantic-only with a result cap, reliable full-library sync is not achievable and this wave downgrades.
2. **Is scheduled background use permitted?** The server is built for interactive AI assistants; our scheduler runs unattended. That is a terms question, not a technical one — and it is answered by reading the developer terms, not by the API returning 200.

**Both are settled by connecting once and calling `tools/list`**, which returns the JSON schema for all 28 tools. It needs one OAuth consent against a real Evernote account.

⛔ **Do not build the provider before the probe.** Writing a provider against guessed parameters is how a wave dies at its live gate.

### 6.2 If the probe passes — an `EvernoteProvider` in the existing registry

The shape maps cleanly onto `providers/base.py`:

| Contract | Evernote MCP |
|---|---|
| `validate(credentials)` | `tools/list` plus a trivial call, returning `AccountInfo` |
| `list_changed(...)` | `search_notes` with an `updated:` watermark, paged |
| `list_present_refs` (full-pass hook) | unbounded `search_notes` enumeration — required for delete detection |
| `fetch` / `fetch_many` | `get_note`, then the **existing** server-side convert layer |
| `fetch_media` | `get_attachment` through `guarded_media_get` (SSRF guard unchanged) |
| `opaque_cursor` | last-seen `updated` watermark — same shape as OneNote's |

**It is a provider module, not a subsystem.** Registration goes in the registry, which is the only provider door and also the live-gate mock seam.

Two genuinely new pieces:

- **An MCP client in the backend.** We would be an MCP *client* for the first time. Dynamic Client Registration means there is no `EVERNOTE_CLIENT_ID` env var to set — registration happens at runtime, and its result must be persisted encrypted in the existing `NOTE_ENCRYPTION_KEY` family exactly like a token. This is a **new credential lifecycle**, not a new key family.
- **ENML conversion.** Evernote bodies are ENML, an XHTML dialect. The `.enex` importer already parses it in `adapters/evernote.js` — but that is **JS on the client**, while connectors convert **server-side in Python**. ⛔ This is a mirrored-lane situation: either port ENML to TipTap into the server convert layer and rail *both* lanes against shared fixtures, or route both through one authority. Do not hand-copy the adapter into Python; that is how one grammar becomes four hand-written copies.

### 6.3 If the probe fails

Fall back to strengthening the `.enex` path: guided in-product export instructions, multi-file `.enex` intake, and a resumable large-import flow. Cheaper, less magical, still ships — and it is the honest answer rather than a connector that silently misses notes.

---

## 7. Wave 3 — Obsidian community plugin

### 7.1 Why the plugin, and not a folder connector

Obsidian is local-first; there is no Obsidian API to connect to. Every alternative door reaches only a slice of users — Dropbox vaults, OneDrive vaults, git vaults — and all of those slices are now closed by the owner's decision. The plugin is the **only door that reaches every Obsidian user regardless of where the vault lives**, including iCloud and Obsidian Sync, which no server-side connector can ever see.

It is also the shortest onboarding in this program: install from inside Obsidian, paste a connect code, done. No third-party OAuth, no folder picker, no cloud intermediary.

And it is a **distribution channel**. The community plugin directory is where Obsidian users browse for tools. A listed plugin puts UCT Intelligence in front of exactly the right audience, permanently, at no marginal cost.

### 7.2 Transport, and the one constraint that matters

Every existing provider is **pull**: the engine holds the cursor, calls `list_changed`, and calls `list_present_refs` on the nightly full pass. The plugin inverts this — it **pushes**.

The tempting shortcut is a fresh ingest endpoint that writes notes straight into `j2_notes`. **That shortcut is forbidden here.** This codebase has already been burned by that exact shape: four readers of one envelope, three of them wrong, all failing to an empty list. A parallel write path would duplicate the conflict ratchet, delete detection, the media phase and the import-hash logic — and the copies would drift apart silently.

**The rule: one authority, two transports.** The ingest endpoint converts the pushed payload into the same `RemoteNote` shape pull providers emit and hands it to the *same* convert → upsert → conflict → media path. The plugin's vault manifest feeds the **existing** `list_present_refs` hook rather than a second delete-detector.

A clean way to satisfy this: model the plugin as a provider whose "remote" is a server-side staging area the plugin writes into. The engine then pulls from staging exactly as it pulls from Notion, and every invariant is inherited rather than re-derived.

### 7.3 Plugin shape

- Separate public GitHub repo (required for listing), TypeScript, built to `main.js` + `manifest.json` (+ optional `styles.css`), attached to a semver GitHub release. The plugin `id` must be unique and **may not contain the word `obsidian`**.
- **Connect code:** generated in UCT under Settings → Connections, short-lived and single-use, exchanged by the plugin for a long-lived device token stored via the plugin's own `saveData()`. This keeps an OAuth browser flow out of Obsidian entirely.
- **First sync:** full vault walk, batched push.
- **Ongoing:** vault `create` / `modify` / `delete` / `rename` events into a debounced queue, then incremental push. Rename is the subtle one — it must move a note, not duplicate it, which means the import key has to be stable across paths rather than derived from the path.
- **Conversion is already built.** `adapters/obsidian.js` has proven pre-passes for `[[wikilinks]]`, `^^highlight^^` and task lists, and the server already converts markdown to TipTap. The plugin needs **transport, not conversion**.

### 7.4 Directory policy — a shipping gate, not a formality

Obsidian's developer policies **prohibit client-side telemetry** and require that **network usage be clearly disclosed**, with a privacy-policy link where data is handled server-side. This plugin's entire purpose is sending vault contents to our server, so:

- The README states plainly what is transmitted, when, and to where.
- A privacy policy link is mandatory (a Privacy page already exists on the site).
- No analytics of any kind inside the plugin.
- Review is automated; the plugin stays non-installable until every flagged error is cleared.

⛔ Treat disclosure as a gate. A plugin that quietly uploads a vault is the fastest way to burn the brand with the audience that cares most about local-first.

---

## 8. Wave 4 — what a migrant misses in the first ten minutes

The instinct is to chase feature parity with three products at once. That is the wrong frame and unbounded. The right frame is narrow: **which absence makes someone close the tab on day one?** Everything else can wait for evidence.

The Notebook is already far richer than the "import target" it is being treated as. It has nested folders, tags, tables, task lists, attachment chips, internal links, **backlinks**, templates, a capture inbox, video timestamps, and live embeds for charts, breadth, scanner, news, watchlist, fundamentals, calendar, alerts and AI search. Most parity questions are already answered.

The real day-one gaps, ranked by bounce risk:

1. **Search quality** — Wave 0. Universal across all three, and the first thing anyone does with a freshly imported library is search it.
2. **Callouts and toggles** — Notion's two most common structural blocks. Without them, imported Notion pages do not merely lose styling, they *look broken*, which reads as a bad import rather than a missing feature.
3. **Saved searches / smart views** — Evernote's organising primitive. Its users navigate by saved search, not by folder.
4. **Daily notes** — Obsidian and Roam. The Roam connector already lands them in a `Daily Notes` folder, so the data arrives; what is missing is the *habit surface* (today's note, one keystroke away). For a trading journal this is a natural fit regardless of migration.
5. **Aliases and unresolved links** — Obsidian vaults are dense with `[[links]]` to notes that do not exist yet. Obsidian renders these as live placeholders; if we drop them, the vault's structure quietly dissolves.

**Deliberately not in this wave:** Notion databases with properties and views (a product in itself), graph view, canvas, OCR-in-image search, and the Evernote web clipper. The clipper is genuinely Evernote's most-loved feature and is a strong fit for clipping research — but it is a *third* distributable artifact after the Obsidian plugin, and the existing capture inbox covers part of the need. Revisit with evidence, not enthusiasm.

### 8.1 The one that actually wins: post-migration enrichment

This is the highest-leverage idea in the program, and it costs less than any parity feature above.

We already have what no note app can offer: a note can embed a **live chart, earnings calendar, scanner, watchlist, fundamentals or news** for a ticker. That capability is built and shipped. What is missing is **discovery** — nobody finds a slash menu on day one, least of all in a library they just imported and have not read.

So invert it. After a migration completes, scan the imported notes for tickers (`extract_plain_text` output already gives clean text, and ticker matching already exists elsewhere in the product — reuse it, and mind that RS/EMA/MA/GAP/PEG are real tickers). Then present a single screen:

> *"We found 47 notes mentioning tickers. Want the live chart on them?"*

One click turns a decade of dead Evernote notes into something their old app structurally cannot do. That is the moment the migration stops being a copy and becomes an upgrade — and it lands precisely when the member is already looking at their imported library and deciding whether this was worth it.

⛔ It must be **opt-in and reversible**. Silently rewriting a member's imported notes is a trust violation, and these are the users most sensitive to it.

### 8.2 The exit that makes the entrance possible

**There is no note export.** The only export endpoint in Journal 2.0 is `/trades/export`. Notes cannot leave.

Nobody moves a decade of writing into a product they cannot leave, and the more valuable the library the more that matters. An export is not a nice-to-have at the end of a migration program — it is a **precondition for asking**. It is also the cheapest trust we will ever buy: a markdown-plus-attachments zip, which is the same shape the importer already reads.

Ship it in the same wave the connectors open, and say so on the connect screen.

---

## 9. Wave 5 — the switch

The connectors deliver notes. This wave delivers the *feeling* that the move happened.

- **The arrival moment.** Import progress is currently a mechanism, not an experience. A member who just moved 4,000 notes should land on a screen that says what came across — counts by notebook, what was skipped and why, what needs attention — rather than being returned to a generic archive list.
- **The trust strip.** Already designed for the connectors: sources, freshness, conflict count. Extend it to answer the question migrants actually ask, which is "is it *all* here?"
- **Honest failure reporting.** Anything skipped must be named and re-runnable. A silent partial import is worse than a failed one, because it is discovered months later on the note that mattered.
- **The enrichment offer** (§8.1).
- **Export** (§8.2) linked from the connect screen, before they commit.

---

## 10. Data model

Additive only, guarded exactly like migrations v2 and v3 — column-probed, flag-filed in `DATA_DIR`, created after prior versions in `ensure_schema`.

- **FTS5 table** over `(title, body_plain)` — derived, rebuildable, never a second authority. The codebase already runs FTS5 in `desk_store.py`, `education_search.py` and `transcript_index.py`; **follow that established pattern rather than inventing a new one.**
- **Plugin device tokens** — one row per installed vault: user, vault id, label, last-seen, revocable. Encrypted in the `NOTE_ENCRYPTION_KEY` family.
- **Connect codes** — short-lived, single-use, session-bound, mirroring the OAuth state discipline already in `oauth.py` (HMAC, TTL, single-use nonce, fail-closed with no secret).
- **Push staging** — the plugin's landing area that the engine pulls from (§7.2).
- **Saved searches** — if Wave 4 item 3 survives triage.
- **Evernote dynamic-client registration record** — encrypted, per §6.2.

---

## 11. Testing and the gate doctrine

This program's greatest risk is not design, it is **verification** — and there is a specific, documented reason.

Every connector wave this codebase has shipped was saved by a live gate, not by unit tests:

- The Dropbox full-listing delete-detection Critical, caught pre-ship.
- The conflict policy that, without the import-hash check, re-tallied conflicts and **resurrected deleted copies on every pass** — caught by a live gate.
- The folder-picker contract break that **both** live gates missed by seeding server-side, caught only by a dedicated picker-walk gate.
- The importer's file-input handlers reading a `FileList` already emptied by `value=''` — **the wizard's front door was 100% broken in a real browser** while jsdom saw nothing, because jsdom's files are not value-bound.

That is four separate occasions where the suite was green and the feature was dead.

**And right now we have zero real accounts.** The owner has no Notion workspace, no Evernote account and no Obsidian vault. Building three connectors under those conditions would remove the only rail that has ever actually worked.

**Fixture requirements, therefore, are a gate on starting — not a task inside the waves:**

| Need | Cost |
|---|---|
| Obsidian vault | Free, local, no account. Minutes. |
| Notion workspace | Account already exists; onboarding creates it. Free tier. Minutes. |
| Evernote account | Free signup. Required for the `tools/list` probe. |

Friends' and members' real libraries remain valuable as the **second** gate — real libraries carry messy shapes a clean fixture never will — but they are not needed to start, and waiting on them is not a reason to delay.

**Per-wave gates:**

- Unit: converter fixtures per block type; provider clients against recorded fixtures, never live calls.
- Contract rails: the vitest schema validation over Python-emitted fixtures; hash parity across the JS/Python lanes (mandatory for ENML, §6.2).
- Live gate: the mock-provider registry seam over real HTTP, full lifecycle.
- **On-screen Playwright**: connect → first sync → the note renders in the real editor. Non-negotiable — it is what caught the front-door break.
- ⛔ Assert on `fetch.mock.calls` **outside** the mock's `json()` callback. An assertion inside is vacuous; the caller's `.catch` swallows it.
- ⛔ Read the suite's summary line. A task exit code reports the wrapper, not the suites.

---

## 12. Rollout

Order, and the reason for it:

| Wave | Why here | Blocked on |
|---|---|---|
| **0 — scale** | Everything else lands on top of it; cheapest before there is data to migrate | nothing |
| **1 — Notion** | Complete code, near-zero cost, proves the whole path end to end | owner finishing Notion onboarding |
| **2 — Evernote probe** | Multi-day latency risk and it decides the wave's shape; fire it early | a free Evernote account |
| **2 — Evernote provider** | Highest-yield audience (see below) | the probe passing |
| **3 — Obsidian plugin** | Largest build; also gated by an external review queue | a local vault |
| **4 — parity + enrichment** | Needs migrated libraries to prioritise against | waves 1–3 |
| **5 — the switch** | Packages everything above | waves 1–4 |

**On audience yield.** The three targets are not equal, and the plan should not pretend otherwise. **Evernote users are actively trying to leave** — pricing changes, ownership churn, and a decade of notes they feel trapped by. They are shopping right now. **Notion users are broadly content**; our connector being finished is a reason to activate it, not evidence it converts. **Obsidian users are local-first by conviction** and the hardest to move to a cloud notebook — but the plugin directory makes them the best long-term brand play.

So Notion ships first because it is nearly free, Evernote is where the conversions are, and Obsidian is the compounding investment.

Every wave stays behind `NOTE_SYNC_ENABLED` plus its own flag. ⛔ A flag defaulting off and set nowhere is indistinguishable from one off on purpose — register each new flag in the ledger (`feature_flag_index.py` derives by AST; `flag_ledger_audit.py` exit 2 means "did not look", not "clean").

---

## 13. Risks and open questions

1. **Evernote MCP is in beta.** Behaviour, tools and supported clients may change under us. Mitigation: the provider is one registry module; if it breaks, the tile goes dark and `.enex` import remains.
2. **Background use may not be permitted** by Evernote's terms (§6.1). This is the single question that can kill Wave 2 outright, and it is answered by reading, not by coding.
3. **Notion's API has moved** since the connector was written (§5).
4. **Obsidian's review queue** is outside our control, and the plugin is non-installable until every flagged error clears.
5. **Volume capacity** is unmeasured (§4.2). This is the failure that would be member-visible and hard to reverse.
6. **No real accounts** (§11) — the gating risk for the whole program.
7. **Concurrent first-time imports** on a single-replica pod (§4.4). ⛔ Never run heavy work on the prod pod alongside uvicorn; that has already caused member-visible outages twice.

---

## 14. Decision log

- **Dropbox / OneDrive / OneNote dropped** (owner, 2026-09-01) — cloud-storage middlemen are not recognisable integrations. Code stays, dark.
- **GitHub connector rejected** — reaches only git-synced vaults, and the plugin covers that slice too. YAGNI.
- **Two-way sync rejected** — fights the migration ratchet (§1.1), doubles the failure surface, nobody asks for it.
- **Obsidian door = community plugin** — the only door reaching every vault regardless of storage, and a distribution channel besides.
- **Evernote reopened** — the August "not viable" verdict was true of EDAM and is now stale (§2.4).
