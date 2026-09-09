# Evernote decision + Obsidian plugin release-readiness — 2026-09-04

Scope: `obsidian-plugin/**`,
`app/src/pages/journal-2-0/lib/importer/adapters/evernote.js` + its tests,
`app/src/pages/journal-2-0/components/notebook/import/ExportGuide.jsx`. No
subagents dispatched. No edits to `note_connectors/**`, `components/connectors/**`,
`lib/importer/commit.js`, `notes_import*`, `docs/feature_flags.json`,
`NotebookTab.jsx`, or anything under `api/`.

## Part 1 — Evernote verdict: PATH B (migration-first), the 2026-09-01 "reopened" call does not survive re-verification

The 2026-09-01 program design (`docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md`
§6) reopened Evernote on the strength of "hosted MCP + OAuth Dynamic Client
Registration removes the manual approval queue" — but its own §6.1 gates
building anything on a **live probe against a real Evernote account**
("Do not build the provider before the probe") that has never run (no
account exists, and I was told not to create one). Re-checking Evernote's
*current* public developer surface without that probe:

**What's true and confirmed (2026-09-04):**
- OAuth 2.0 + Dynamic Client Registration is real and working today — a
  compliant MCP client connects with no manual app registration.
  <https://dev.evernote.com/mcp/clients/any>, <https://dev.evernote.com/mcp/authentication>
- 28 tools exist (`create_note`, `get_note`, `edit_note`, `delete_note`,
  `search_notes`, `semantic_search`, notebooks/tags/tasks/attachments), richer
  than the marketing page implies. <https://dev.evernote.com/mcp/tools>
- The old classic EDAM API (the one with the manual approval queue that
  killed the August attempt) is now **deprecated**, "no longer actively
  developed," kept only "so you can maintain existing integrations."
  <https://dev.evernote.com/documentation/>

**What blocks building a connector today, none of it resolved by DCR:**
- **Still beta.** "In beta. The Evernote MCP server is rolling out
  gradually. Tools and supported clients may change." — and separately,
  "It's in beta while we refine it." <https://dev.evernote.com/mcp>,
  <https://dev.evernote.com/mcp/faq> (both fetched 2026-09-04)
- **Paid plans only.** "The MCP server is available on paid personal,
  Business, and Teams Evernote plans. Free (Basic) accounts aren't
  included." <https://dev.evernote.com/mcp/faq> — a hard exclusion of
  exactly the free-tier Evernote refugees this migration targets.
- **No public evidence of the two capabilities §6.1 said would decide
  this**: whole-library enumeration and an incremental/cursor query grammar
  for `search_notes`. The parameter-level tool reference 404s publicly
  (`dev.evernote.com/mcp/tools/search_notes`); nothing published confirms
  `search_notes` supports `updated:`/`notebook:` filtering or pagination
  sufficient for `list_changed`/`list_present_refs`-style sync.
- **No public answer on scheduled/unattended use** (§6.1's "terms question") —
  not mentioned in the FAQ, guidelines, or auth docs.
- **Undocumented rate limits**: "tool calls are rate-limited per minute —
  both per tool and across all tools," no numbers published.
- **Independent, dated, hands-on evidence agrees it isn't a sync tool yet**:
  usecarly.com (2026-07-11): *"Evernote's official MCP server for Claude is
  a waitlist, not a shipped product"*; *"Any MCP setup only works inside a
  conversation you start"*; *"no background syncing, bulk export
  functionality, or automatic listing of all notes"*; framed as *"an
  assistant you operate,"* not *"an agent that runs."*
  tamingthetrunk.com (2026-06-26) is a real hands-on write-up but explicitly
  defers any reliability/completeness verdict to "after full public
  release" — i.e. even an active user hasn't validated the primitives a
  sync connector needs.
- Backend registry already encodes this: `registry.configured("evernote")`
  and `registry.is_known("evernote")` are both `False`
  (`api/services/journal_two/test_note_connectors_registry.py`) — no
  provider was ever built, consistent with the probe never having run.

**Decision: PATH B.** The DCR claim is true but narrow — it removes one
blocker (manual app review) while leaving every other precondition the
original design itself required unresolved, and adds a new one (paid-plan
gating) the original design didn't know about. Nothing here should be read
as "closed forever" — if the owner gets a paid Evernote account and the
`tools/list` probe shows real enumeration + cursor support and an
acceptable ToS answer, Wave 2 is still exactly the right next step; it just
hasn't happened.

**Work done (owned files only):**
- `ExportGuide.jsx`: added an explicit, self-contained line to the Evernote
  card — "this is a one-time import, not an ongoing connection... Evernote
  has no 'keep syncing automatically' option here (unlike Notion or
  Obsidian above)" — plus a header comment recording this decision, its
  evidence, and a pointer to this report, so a future reader doesn't
  silently inherit "reopened" again. The desktop-only /
  not-possible-on-Evernote-Web fact was already present from the 2026-09-02
  session and is unchanged.
- Confirmed structurally (read-only, not my file): `ConnectTilesCompact.jsx`
  + `NOTE_CONNECTOR_PROVIDERS` already exclude `evernote` entirely — the
  "Connect and keep syncing" tiles never show it. The Import-vs-Connect
  distinction the task asked for already exists structurally; my change
  makes it explicit in the copy too, so it survives even if a member never
  notices the tiles above the dropzone.
- `evernote.js` + `evernote.test.js`: reviewed in full — already a mature,
  well-tested `.enex` adapter (en-todo/en-media self-closing-tag traps,
  MD5-deduped resources, mixed-platform-drop warnings). No changes needed.
- Ran `npx vitest run src/pages/journal-2-0/lib/importer` from `app/`:
  **12 files / 144 tests passed** (includes `evernote.test.js` 5/5 and
  `ExportGuide.test.jsx` 6/6, run separately and together with the same
  result).

## Part 2 — Obsidian plugin: release-ready, no blocking defect found

**Build:** `npm run build` (`tsc -noEmit -skipLibCheck && esbuild production`)
succeeds clean, no errors. `main.js` produced (10,409 bytes, minified,
correct esbuild banner).
**Tests:** `npm test` (vitest) — **5 files / 50 tests passed**: hashing,
batching, sync-plan, api-client, sync-manager.

**manifest.json / versions.json** — checked against Obsidian's current
published rules (fetched 2026-09-04, <https://docs.obsidian.md/Reference/Manifest>,
<https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>): `id`
(`uct-notebook-sync`) is lowercase-hyphen, doesn't end in `plugin`, doesn't
contain `obsidian` — confirmed against the exact current rule, quoted
twice independently: *"The `id` must be unique across all published plugins
and can't contain `obsidian`."* `name` doesn't contain "Obsidian"/"Plugin".
`version`/`versions.json` are valid `x.y.z` and consistent with each other.
`isDesktopOnly: true` is correct and necessary (the plugin imports Node's
`crypto` directly for hashing + vault-id generation). All required fields
present. Not independently verified: whether `minAppVersion: "1.5.0"` is the
*true* floor for the specific Obsidian APIs used (`requestUrl`, `Setting`,
`PluginSettingTab`, `Notice`) — no live Obsidian install available to test
against; nothing in the code suggests a newer floor is needed, but the
owner should smoke-test in a real vault before relying on this number.

**The `list_present_refs` invariant (the one the task called load-bearing)**
is honored correctly and is explicitly tested: `sync-plan.ts`'s
`planSync`/`finalizeManifest` keep a too-large note that synced fine
*before* it grew in the manifest (never treat "can't push now" as "delete
it"), while correctly excluding a note that was *never* successfully staged
— matching `providers/obsidian.py::list_present_refs`'s documented contract
exactly. Pinned by `sync-plan.test.ts` ("stays manifested" / "KEEPS a path…
the growth case") and `sync-manager.test.ts` ("no spurious deletion").
Delete detection (a locally-removed file drops out of the next manifest) is
also tested end-to-end.

**Other invariants reviewed:**
- **Connect-code / auth flow, token storage, revocation**: standard
  Obsidian `loadData`/`saveData` JSON blob (plaintext — normal for this
  platform, no OS keychain API exists for plugins). A 401 clears the token
  and asks for reconnection; `vaultId` is deliberately preserved across a
  reconnect so the server rotates the same device row instead of orphaning
  one. "Forget connection" is explicitly documented as local-only (real
  revocation is server-side, in the dashboard). Tested.
- **Manifest logic / deletion semantics / oversized files**: see above —
  correctly implemented and tested, including the mixed-vault case.
- **Path normalisation**: N/A — the plugin never takes a user-typed vault
  path; the only free-text field is the server URL, which is trimmed and
  slash-stripped appropriately.
- **Wikilinks / embeds / attachments**: correctly out of scope for the
  plugin by design — it pushes raw markdown text only; `[[wikilinks]]`,
  `==highlights==`, and embed resolution are server-side
  (`providers/obsidian.py`), matching that module's own docstring
  ("the plugin only ever pushes markdown TEXT... never binary files").
- **Renamed files** — a real, previously-undocumented gap: identity is
  derived from `vault_path`, so a rename reads as delete-old + create-new
  rather than an in-place rename (no data loss — the old server copy
  survives until delete-detection catches up — but a member mid-edit on
  that note in the Notebook would see two notes briefly). Now documented in
  `README.md`'s "What it does NOT do" section; fixing it needs a stable
  note id on the wire, a two-repo change out of scope here.
- **Retry/backoff**: deliberately absent in v1 (README already said so). A
  mid-run transient failure aborts the whole sync but loses nothing —
  already-staged batches just get harmlessly re-pushed next run (server
  no-ops an unchanged hash), and no manifest is ever sent for an
  incomplete run, so nothing gets falsely marked deleted. Confirmed by
  `sync-manager.test.ts`'s "stops the run on a mid-batch failure" case.
  Expanded README's documentation of this rather than building retry logic
  blind — the review brief for Part 1 warned against exactly that pattern.
- **No silent note loss**: traced every failure path (mid-batch 5xx, 401,
  too-large, delete, rename) — every one either surfaces in the Settings
  tab, is a documented/tested no-op, or is now explicitly written down as a
  known limitation. Found nothing silent.

**Fixed (small, in-scope):** `settings.ts` set an inline `p.style.color`
for the last-sync-error message — a direct hit on Obsidian's own published
guideline ("avoid inline style assignments," "use CSS classes with Obsidian
CSS variables," fetched 2026-09-04). Moved to a new `styles.css` (one class,
same `var(--text-error)` value). Rebuilt + retested clean after the change
(50/50).

**`RELEASE.md`** (new) — the exact, ordered, copy-pasteable commands and
values: repo name, directory move + rebuild-and-reverify, tag/release-asset
commands, and the submission steps. This required re-verifying Obsidian's
submission process, which **changed earlier in 2026**: it is no longer a
pull request against `community-plugins.json` — it's a self-service
developer dashboard at community.obsidian.md (sign in, link GitHub, choose
the repo, automated review "typically within a few minutes," live in the
app "within 24 hours" once approved) — confirmed at
<https://obsidian.md/blog/future-of-plugins/> and
<https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin> (both
fetched 2026-09-04). `README.md`'s existing submission section (written
2026-09-02) was updated to match and now points to `RELEASE.md` for the
exact steps rather than re-deriving them narratively in two places. The
equivalent classic JSON entry (`{id, name, author, description, repo}`,
confirmed against a real current entry in
`obsidianmd/obsidian-releases/community-plugins.json`) is included in
`RELEASE.md` for reference since the task asked for it explicitly, labeled
as reference/fallback rather than the primary current path.

**Verdict: the plugin is ready for the owner to publish.** The only
remaining step is genuinely the one the plugin cannot do for itself
(GitHub repo creation + Obsidian-account submission, both requiring
credentials I don't have and can't enter). No blocking defect found.

## Concerns / things the owner should know

1. Evernote: nothing changed server-side or in `note_connectors/**` — I
   didn't touch those, by scope. If another agent working there still
   assumes "Evernote reopened," that assumption should be revisited against
   this report.
2. `minAppVersion: "1.5.0"` in the Obsidian plugin manifest was checked for
   *format* correctness only, not empirically verified against a running
   Obsidian install (none available in this environment) — smoke-test in a
   real vault before the first real release.
3. The renamed-file behavior (delete-old + create-new) and the no-retry
   behavior are now documented, not fixed — both are real v1.1 candidates,
   not defects, but the owner should read `README.md`'s "What it does NOT
   do" section before promising members more than this plugin does today.
4. Two other agents are concurrently modifying `note_connectors/**` /
   `components/connectors/**` / `lib/importer/commit.js` /
   `docs/feature_flags.json` / `NotebookTab.jsx` in this same worktree per
   this task's file-ownership boundary — this report and its commit touch
   only the files this task assigned me.
