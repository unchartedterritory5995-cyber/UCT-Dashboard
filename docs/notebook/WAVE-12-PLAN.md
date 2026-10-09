# Notebook wave 12: templates, and every open clause sorted (2026-10-02)

Written by the wave-12 planner (session 441b0c89), read-only on code, from master `cf5e38d5d2`.
It extends `NOTEBOOK-10-OF-10-PLAN.md` and `WAVE-11-PLAN.md`; it replaces neither.

The owner's scope for this wave, verbatim (`docs/notebook/WAVE-11-PLAN.md`:20):

> "A much deeper built-in library for traders: trade plans by setup, earnings prep, post-mortems,
> weekly and monthly reviews, sector notes, position tracking with the 11B formulas already wired
> in. Each template comes with a short walkthrough. Then members save their own notes as
> templates, share them, and browse a community template gallery (reviewed before publishing; no
> code, so no plugin security risk)."

Every `file:line` below was read at `cf5e38d5d2`. A line number is a dated claim: re-read the
line before acting on it.

---

## 0. What the brief assumed that the tree does not say

1. **The owner asked for review BEFORE publishing**, not only report-and-hide after it
   (`WAVE-11-PLAN.md`:20, "reviewed before publishing"). Lane 12A needs a pending state that an
   admin approves before anything is listed. Report and hide still apply after approval.
2. **The owner's wave 12 starts with the built-in library**, then the gallery (same line). The
   built-in half is lane 12B below.
3. **A "gallery" already exists, and it is not this one.** Wave 10 made the built-in Templates
   dialog a browsable gallery (`app/src/pages/journal-2-0/components/notebook/TemplatePicker.gallery.test.jsx`:1).
   No community or shared template gallery exists anywhere in `app/src`, `api` or `tests` (searched
   for `template.gallery`, `community.template`, `shared_template`, `public_template`). Name the
   new thing "community gallery" in code and copy, or the two will be confused.
4. **The Floor already has reports and an admin queue**: `POST /api/community/reports`
   (`api/routers/community.py`:338), `GET/PATCH /api/community/admin/reports` (`:397-419`) and
   `app/src/components/admin/CommunityReportsPanel.jsx`. Its "hide" is a soft delete
   (`community.py`:409-414). Copy the shape, not the tables: the Floor lives in `community.db`;
   a template is member Notebook content and belongs in `auth.db` beside `j2_note_templates`
   (`api/services/journal_two/db.py`:1881).
5. **A member template's images point at the author's other note.** `note_templates.py`:15-16
   says so in its own header. A published template must drop them (12A, privacy).
6. **The catalog's own header is stale twice.** It says "Eight firm-authored ... in three families"
   (`app/src/pages/journal-2-0/lib/notebookTemplates.js`:5); there are 25 keys and 4 families. It
   forbids tables (`notebookTemplates.js`:11-17, railed at `notebookTemplates.test.js`:107) although
   the editor has loaded the table extension since wave 6 (`app/src/pages/journal-2-0/lib/tiptap.js`:22).
   Lane 12B lifts that rule on purpose.
7. **The scorecard says 3 of 16 standards at bar** (`docs/notebook/parity-scorecard.md`:435); the
   plan's header still says 0 of 16 (`NOTEBOOK-10-OF-10-PLAN.md`:11). The scorecard is current.
8. **The restore-drill clause needs no build.** The scorecard files it under "Build work"
   (`parity-scorecard.md`:641-643), but the weekly task `UCT-AuthDB-Restore-Drill` is registered
   (`tools/authdb_restore_drill.py`:591-605). Read-only check on this box, 2026-10-02: last fire
   2026-09-27 09:00 local, exit 2, `VERDICT: INCONCLUSIVE` (the pre-manifest tarball the scorecard
   names); next fire **2026-10-04 09:00 local**. What it needs is an observation (12F).
9. **All four wave-11 features are dark** (`docs/feature_flags.json`: `NOTEBOOK_VOICE_NOTES_ENABLED`,
   `NOTEBOOK_FORMULAS_ENABLED`, `NOTEBOOK_AI_ACTIONS_ENABLED`, `NOTEBOOK_TRADE_CANVAS_ENABLED`).
   A template that wires formulas must still work with formulas off (12B-2).

---

## 1. Lane 12A: community template gallery (IN FLIGHT)

**Status:** being built now by another agent: branch `feat/notebook-w12a`, worktree
`C:\Users\Patrick\uct-worktrees\notebook-w12a`, flag `NOTEBOOK_TEMPLATE_GALLERY_ENABLED` (unset =
off, dark; an enablement gate). No commit on it yet at the time of writing. This plan does not
re-design it; it records the contract other lanes must not collide with.

**The contract, as briefed, plus what the tree adds:**
- A member publishes one of "Your templates" (opt-in, shows the author's display name only). It
  enters **pending**; an admin approves before it is listed (§0.1). Members browse, preview, and
  "Use template", which copies it into the user's own "Your templates" (a copy, never a link).
- A firm-curated "UCT templates" section; report; admin hide and unhide. **Hide is a status
  column, never a DELETE** (kill-switch rule). The kill switch is the flag. Account deletion of
  the AUTHOR removes their listings through `account_purge.py` (that is a member's own data
  request, not a kill switch); copies other members already made stay theirs.
- Privacy runs through **the one public reducer**, `api/services/journal_two/public_note_payload.py`,
  as a third mode beside `share` and `publish` (`MODES`, `:119`; `NODE_POLICY`, `:223`). Its own
  rule: a second reducer is a second authority (`:5-6`). The gallery mode needs a row for every node
  type (the rail derives the list from `notebookSchema.js`). At minimum: images and every
  image-bearing attribute dropped (re-upload is a later step), `noteLink` to plain text,
  `askInsert`/`askCitation`/writing-help output dropped (they were computed from the author's
  private notes), `attachmentChip` dropped, market-data nodes to a neutral line, in-app links
  scrubbed, task items unchecked. Properties: relation values dropped (they name the author's
  notes); custom-property values dropped unless the definition travels with the template.
- Rate limits on publish and report per member (the `notebook_shares.py`:44-46 pattern, in-memory
  per process; note it in CLAUDE.md's single-process list).

**Files 12A owns this wave. No other lane edits them until 12A lands on the landing branch:**
`api/services/journal_two/note_templates.py`, `public_note_payload.py`, `db.py`,
`account_purge.py`; `api/services/address_space.py`; `api/main.py` (router mount); any new
`api/routers/*template*` and `api/services/journal_two/*gallery*`; `docs/feature_flags.json`;
`app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx` (+ `.module.css`),
`TemplatePreview.jsx`, `MemberTemplates.jsx`; `app/src/pages/journal-2-0/lib/memberTemplates.js`,
`lib/noteCreation.js`; `app/src/pages/journal-2-0/tabs/NotebookTab.jsx`; `app/src/components/admin/*`;
the a11y surface manifest `app/src/pages/journal-2-0/a11y/notebookSurfaces.js`.

**Rails 12A is expected to carry:** the node-policy table rail extended to the new mode; a route
census entry for every new route (flag-off = one 404 before any session read, the
`notebook_shares.py`:56-67 shape); `tests/test_address_space.py` (a new owned, named table must be a
kind or an exemption); `tests/test_journal_two_account_purge.py`; the flag-ledger rail; a
real-browser walk of publish -> approve -> browse -> preview -> use -> report -> hide -> unhide at
390 and 1200, keyboard included.

---

## 2. Every other open clause, sorted

**Classes.** (a) BUILDABLE by an agent now. (b) needs a measurement or a walk only, by an agent or
the controller, no member, no device, no letter. (c) BLOCKED on the owner or the world: real
traders, a 30-day window, vendor letters, devices, legal, or a recorded "no" only the owner can
reverse.

### 2.1 The standards' clauses (§B) that are not MET: 20

**(a) 0 · (b) 2 · (c) 18.** Nothing in §B is honestly buildable: every remaining miss is a
reading, a letter, a device, a person or a ruling. The buildable work is lane 12B (the owner's
scope, no open clause) and the tooling inside 12D/12E.

| # | clause | cite | class | what closes it |
|---|---|---|---|---|
| 4d | typing < 16 ms/char up to the size cap | `parity-scorecard.md`:477 | **(b)** | 12E: a quiet-box reading that agrees with one of the two disagreeing quiet readings |
| 7a | restore rehearsed end-to-end on a schedule | `:508` | **(b)** | 12F: the 2026-10-04 09:00 scheduled fire reads PASS |
| 1a | every weekly feature exists for members | `:443` | (c) owner + vendor | G-043 store submission; G-127 zero retention in writing |
| 1b | or is a recorded, deliberate "no" | `:444` | (c) owner + vendor | the same two; ruling either one "no" to close this clause would be gaming it |
| 1c | the list is what competitor users reach for weekly | `:445` | (c) real traders | the user study's screener |
| 3a | zero data-loss over 30 days with real members | `:464` | (c) 30-day window | the soak, `docs/notebook/soak-30day.md` |
| 5a | a task-based test with 5-8 traders | `:487` | (c) real traders | `docs/notebook/user-study-kit.md` |
| 5b | every core task completed unaided | `:488` | (c) real traders | same |
| 5c | SUS >= 80 | `:489` | (c) real traders | same |
| 8a | vendor data terms verified in writing | `:518` | (c) vendor letter | Anthropic and OpenAI, zero retention |
| 9c | a full screen-reader pass (VoiceOver + NVDA) | `:531` | (c) owner + Apple device | `docs/notebook/a11y-second-review-brief.md` |
| 10a | iOS + Android capture parity | `:540` | (c) device | run the Shortcut on an iPhone (G-044) |
| 10b | cold-start offline | `:541` | (c) recorded no, D19 | only an owner reversal of D6/D19 |
| 10c | real-device matrix green every release | `:542` | (c) device | BrowserStack Live per landing, or buy Automate |
| 11b | two-way sync where offered | `:552` | (c) recorded no, D18 | only an owner reversal |
| 12c | semantic retrieval | `:563` | (c) vendor letter | arm meaning search after zero retention |
| 12d | all on verified vendor terms | `:564` | (c) vendor letter | same letter |
| 13a | keyword + meaning search | `:572` | (c) vendor letter | same letter |
| 14c | size-cap notes | `:585` | (c) recorded no, D20 | only an owner reversal |
| 16a | first useful note in < 2 minutes unaided | `:605` | (c) real traders | the user study |

**Consequence worth saying plainly:** under rulings D18, D19 and D20, standards 10, 11 and 14 can
never reach bar (`NOTEBOOK-10-OF-10-PLAN.md`:168-170). The ceiling today is **13 of 16**, not 16.

### 2.2 The row verdicts (§C) that are BEHIND, NOT-VERIFIED or BLOCKED: 72 rows

**(a) 0 · (b) 62 · (c) 10.** Lines are `parity-scorecard.md`.

- **(b) competitor citation missing, 54 rows:** G-004:675, G-005:676, G-011:677, G-013:678,
  G-014:679, G-015:680, G-021:682, G-022:683, G-024:684, G-031:685, G-032:686, G-036b:688,
  G-041:689, G-080:696, G-085:698, G-102:699, G-110:700, G-113:701, G-121:702, G-122:703,
  G-123:704, G-124:705, G-125:706, G-129:708, G-130:709, G-131:710, G-133:711, G-134:712,
  G-135:713, G-137:714, G-138:715, G-139:716, G-140:717, G-141:718, G-142:719, G-143:720,
  G-144:721, G-145:722, G-146:723, G-147:724, G-148:725, G-149:726, G-150:727, G-151:728,
  G-152:729, G-154:731, G-156:732, G-158:733, G-160:735, G-161:736, G-167:741, G-169:743,
  G-171:744, G-172:745. Each needs a vendor page that states it, quoted verbatim. Lane 12C.
- **(b) a browser pass with a model key, 5 rows:** G-050:693, G-051:694, G-162:737, G-165:739,
  G-166:740. Lane 12D, on production as `bench@`.
- **(b) a sandbox or clock walk, 3 rows:** G-003:674 (account deletion), G-045:692 (scanned PDF
  then search), G-153:730 (one reminder end to end). Lane 12D.
- **(c) 10 rows:** G-017:681, G-052:695, G-127:707 (vendor terms, external); G-043:690 (store
  submission); G-044:691 and G-084:697 (an iPhone); G-159:734 and G-164:738 (real devices);
  G-168:742 (screen-reader passes); G-035:687 (owner ruling at the size cap; below it, 12E).

### 2.3 The lanes and steps

#### 12B: the deeper built-in library, with walkthroughs (a), branch `feat/notebook-w12b`

The owner's first ask. Not tied to an open clause ("member templates" is MET, `:608`), so it
raises no score; it is the wave's product.

- **Files (only these):** `app/src/pages/journal-2-0/lib/notebookTemplates.js`,
  `lib/notebookTemplates.test.js`, a new `lib/templateBlocks.js` (toggle, callout and table
  builders, Notebook-only; do NOT edit the shared `app/src/lib/tiptapDocBuilders.js`, which the
  Model Book also imports), `lib/templateContext.js` only if a template needs a new context field,
  and a new walk `tools/notebook_w12b_templates_walk.py`. **No edit to `TemplatePicker.jsx` or any
  12A file.** Before starting, run `git diff --name-only origin/master...origin/feat/notebook-w12a`;
  if 12A touched `notebookTemplates.js`, wait for 12A to land on the landing branch.
- **Content (owner's list):** trade plans by setup (one per setup family: base breakout, pullback
  or flag, episodic pivot or earnings gap, reclaim or undercut-and-rally, parabolic short); an
  earnings-prep note; a deeper post-mortem; deeper weekly and monthly reviews; a sector note. Keep
  every existing key and its meaning: `?new=<key>` deep links are stable API (`notebookTemplates.js`:19-20).
- **Walkthrough:** each template carries a `walkthrough` array in its catalog entry (3-5 short
  steps, data, so a later preview can show it) and renders it as a collapsed `toggle` titled "How
  to use this template" at the END of the body. `templatePreview()` (`:776`) and
  `templateStructure()` (`:762`) must skip that toggle, or every card's preview turns into the
  walkthrough text.
- **Tables allowed:** replace the `containsTableNode` assertion (`notebookTemplates.test.js`:107)
  with a derived one: every node type a template builds is a key of the schema table in
  `notebookSchema.js`. Fix the stale header (§0.6).
- **No new schema node.** Toggle, callout and table already exist. If a template seems to need a
  new node type, stop and ask the controller (never-revert rule, §3).
- **Acceptance:** the catalog tests and the derived gallery tests (`TemplatePicker.gallery.test.jsx`,
  `TemplatePicker.gallerySearch.test.jsx`) green, scoped; every template builds a valid doc with
  `{}` and with the rich context; a rail that every template has a walkthrough and that the preview
  never shows it (mutation-proved: remove the skip, the rail reds). Real-browser walk on a sandbox:
  create a note from each new template at 390 and 1200, the editor opens it with no schema refusal,
  the walkthrough toggle opens by keyboard, no page error.

#### 12B-2: position tracking with the 11B formulas wired in (a), branch `feat/notebook-w12b2`

- **After 12A lands** on the landing branch: it touches the template-apply path (`lib/noteCreation.js`,
  `tabs/NotebookTab.jsx`) that 12A also edits.
- A "Position tracker" template whose catalog entry declares formula properties (R-multiple, risk
  per share, position size) built from number properties. On apply, the client creates or reuses
  the member's property definitions, then the note. With `NOTEBOOK_FORMULAS_ENABLED` off the
  template still creates the note and leaves the formula properties out: never a 400, never a
  half-applied write (the one-write rule in `note_templates.py`:18-22).
- **Acceptance:** unit rails for both flag states; a real-browser walk on a sandbox with the flag on
  (the `tools/notebook_w11b_formula_walk.py` sandbox recipe, a new driver, not an edit of that one):
  numbers typed, formulas compute, the table view sorts by one.

#### 12C: competitor citations, then the re-score (b), branch `feat/notebook-w12c`

- **Owns** `tools/parity_scorecard.py` and `docs/notebook/parity-scorecard.md` for the whole wave.
  No other lane edits either; other lanes write evidence, 12C folds it in.
- **Phase 1, now:** for the 54 rows in §2.2, fetch the vendor's own help page that states the
  capability (Notion's help centre, Evernote's help, Obsidian's help docs). Keep page text OUT of
  the repo in a scratch pages dir (`<page id>.txt`), add each quote and its source (URL, fetch time,
  sha256) to the `QUOTES`/`SOURCES` data in `tools/parity_scorecard.py`, and prove them with
  `python tools/parity_scorecard.py --dry-run --pages <dir>`. Re-fetch 10% at random as the D-9B3
  control. A page that cannot be fetched, or does not say it, leaves the cell NOT-VERIFIED and is
  named in the report, never inferred. A quote can move a cell to BEHIND as easily as to PARITY;
  record what the page says.
- **Phase 2, at the end, on the landing branch:** fold in 12D, 12E and 12F evidence, then
  `--write`, then `--verify`.
- **Acceptance:** `tests/test_parity_scorecard.py` green; `--verify` clean at the recorded revision;
  the report lists every row that moved and every row that could not.

#### 12D: the browser passes the rows owe (b), branch `feat/notebook-w12d`

- **Files:** a new `tools/notebook_w12d_walk.py` (driver never imports `api.*`; sandbox via the perf
  harness's `Sandbox`, as the wave-11 walks do) and evidence under `docs/notebook/evidence/w12d/`,
  committed raw BEFORE any summary (R-RAW). No product code.
- **Sandbox passes:** G-003, sign up, write a note with an attachment, delete the account through
  the product, confirm notes and attachment are gone and the tombstone exists. G-045, upload a
  scanned PDF fixture and find a word that exists only in the image text; if the sandbox has no
  OCR engine (`api/services/journal_two/document_ocr.py`:781 claims work only when one exists),
  run this one on production instead.
- **Production passes as `bench@uctintelligence.internal`** (the member synthetic account; its own
  Playwright context, never the owner's Chrome; everything created is trashed through the product):
  G-050 Ask current note, G-051 Ask Notebook, G-165 summarize/rewrite/continue/translate and
  autofill, G-166 Ask over a docx or image attachment, G-162 dictation with Chromium's fake audio
  capture from a committed wav. G-153: create a task due today before the 07:00 or 09:00 ET
  reminder pass (`api/services/journal_two/note_tasks.py`:118-119) and observe the in-app reminder.
  Cost: a handful of model calls, inside the daily caps.
- **Acceptance:** each row has a walk.json check with PASS or a named FAIL; a FAIL is a finding
  for the controller, not something to fix in this lane.

#### 12E: the typing reading, clause 4d (b), controller, branch `feat/notebook-w12e`

- **No code.** A quiet hour with **no other agent running and no gate**: TY8's interleaved A/B and
  the L15 configuration, back to back, with `tools/gate_box_sampler.py --watch-pid` sampling
  THROUGHOUT each run (both earlier quiet readings were checked only at their ends,
  `docs/notebook/perf-budgets.md`:995-1004). Evidence to `docs/notebook/perf-runs/w12-typing/`.
- **Acceptance:** busy p95 read per ruling D24 (`NOTEBOOK-10-OF-10-PLAN.md`:174); the clause moves
  only if this reading agrees with one side and its sampler shows the box quiet across the whole
  run. The 16 ms line is never moved.

#### 12F: the restore drill's scheduled fire, clause 7a (b), controller step

- Before Sunday 2026-10-04 09:00 local: confirm `C:\Users\Patrick\uct-worktrees\notebook-soak-ref`
  is at `origin/master` (read-only) and that `DATA_SYNC_*` is set in the user environment.
- After it: read `C:\Users\Patrick\uct-q1-observe\restore_drill.run.log` and
  `soak-drills\drill-2026-10-04.md`. Commit a copy under
  `docs/notebook/evidence/restore-drill-2026-10-04/` (on `feat/notebook-w12e`). PASS closes 7a in
  12C phase 2; anything else is reported as read, never retried by hand to make it pass.

---

## 3. Order, parallelism and landing

**Cap: three agents at once on this box, integrator included** (CLAUDE.md). One six-shard gate at a
time. Backend pytest by named files only. Every lane commits and pushes at every green checkpoint.

| when | slot 1 | slot 2 | slot 3 |
|---|---|---|---|
| now | 12A (running) | planner (this doc; frees on report) | open |
| next | 12A | **12B** | **12C phase 1** |
| when 12C phase 1 or 12B reports | 12A or 12B | **12D** | |
| after 12A lands on the landing branch | **12B-2** | 12D | |
| all lanes in, box otherwise idle | **12E** alone | | |
| Sunday 2026-10-04 09:00 local | 12F (a log read; any lane may be running) | | |
| last | **12C phase 2**, then the gate | | |

**Branches.** Each lane is `feat/notebook-w12<x>` from master (`w12a`, `w12b`, `w12b2`, `w12c`,
`w12d`, `w12e`). The landing branch is `feat/notebook-w12-landing` from master. The integrator
re-runs each lane's scoped tests in its own session before merging it in; a lane's "done" is
evidence, not a verdict.

**The gate.** From a separate worktree on a `notebook-*` branch (for example
`notebook-w12-gate`), never an implementer's worktree: `python scripts/gate_shards.py --shards 6`,
against a baseline re-adopted from a fresh master gate (D16). Record under
`docs/notebook/gate-runs/wave12-landing/`. Read the manifest's totals and `GATE EXIT`, never the
task status. Carry-over only under C0-C5. Every lane is also walked in a real browser (D17).

**Commits.** `python tools/check_repo_hygiene.py --staged` before every commit; `git commit -F -`
with a quoted heredoc; never `git add -A`; in a shared worktree, commit with a pathspec.

**One PR at the end:** `feat/notebook-w12-landing` -> master. The owner deploys it. The gallery
ships dark; arming is an owner flip after its walk.

**Never-revert schema rule.** No lane in this plan adds a TipTap node type. If one turns out to be
needed, stop and ask first: it must land in both `app/src/pages/journal-2-0/lib/notebookSchema.js`
and `api/services/journal_two/notebook_schema.py`, take a `NODE_POLICY` row in every public mode
(including 12A's new one) and its citation-table rows, and it joins the keep-list in
`docs/notebook/wave5-rollback.md` that no rollback ever reverts.

---

## 4. What 100% and beta-ready still need from the owner

1. **Deploy** the wave-12 PR, and before it any earlier landing still waiting.
2. **The gallery's review step:** confirm the owner's "reviewed before publishing" means admin
   approval before listing, and name who approves. Then arm `NOTEBOOK_TEMPLATE_GALLERY_ENABLED`.
3. **Arm the four wave-11 features** (voice notes, formulas, AI actions, trade canvas) once their
   walks are accepted; each is a production flip.
4. **Zero-retention terms in writing** from Anthropic and OpenAI. That one step moves 1a, 1b, 8a,
   12c, 12d and 13a, and lets meaning search arm.
5. **Submit the browser extension** to the Chrome Web Store (G-043; 1a and 1b).
6. **Devices:** run the iOS Shortcut on an iPhone (G-044); a device run per release on BrowserStack
   Live, or buy Automate (Desktop and Mobile, $225 a month) to script it (10a, 10c).
7. **A screen-reader pass,** VoiceOver and NVDA, by a person (9c).
8. **The user study** with 5-8 traders (1c, 5a-c, 16a).
9. **The 30-day soak** with real members (3a). It starts when an organic cohort exists and cannot
   close sooner than 30 days after that.
10. **Keep this PC on** for Sunday 2026-10-04 09:00 local, with `DATA_SYNC_*` set, so 7a can close.
11. **Decide whether the three recorded "no" rulings stand** (D18 two-way sync, D19 cold-start
    offline, D20 the size cap). While they stand, 13 of 16 standards is the ceiling, and that is a
    scope decision, not a defect.

## 5. Rulings taken 2026-10-02 (controller, owner-delegated: "figure it out")

- **D18, D19 and D20 STAND.** Each "no" protects member data or the rollback path, and none
  is worth that cost for a scorecard number:
  - two-way sync writes into systems we cannot roll back;
  - a caching service worker can serve a stale bundle straight through a rollback, which is the
    one failure a beta rollout must never have;
  - virtualising the editor is a large rewrite for the top few percent of note sizes.
- **Re-confirmed 2026-10-09.** The owner delegated D18/D19/D20 again ("whatever is the best
  product") and the answer is unchanged, for the same three reasons above: the members' data
  and the rollback path are worth more than three scorecard clauses. Recorded so nobody reads
  these as open questions.
- **So the finish line is 13 of 16 standards at bar.** Standards 10, 11 and 14 finish at their
  maximum with these clauses recorded as deliberate no's. The remaining 18 (c) clauses are the
  owner's beta-testing plan: people, devices, vendor letters and calendar time.
- **Gallery review step:** owner's "reviewed before publishing" (WAVE-11-PLAN.md:20) is read as
  admin approval before a template is listed. Any admin approves.
- **Wave-11 arming:**
  - trade canvas and AI actions are armed after the peer measurement window closes;
  - formulas are armed after a quiet 50k reading;
  - voice notes stay dark until the OpenAI zero-retention item (owner list item 4) is settled,
    because it would send meeting audio, including other people's voices, to an organisation whose
    retention is unverified.
