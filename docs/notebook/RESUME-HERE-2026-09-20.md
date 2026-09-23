# Notebook — RESUME HERE (2026-09-20)

> **Read this before touching the Notebook.** It carries the state, the
> instruments, the traps, and the remaining work to launch as a real competitor
> to Notion / Obsidian / Evernote.
>
> Companion documents, still authoritative for their own scope:
> `wave-q1-RESUME-HERE.md` (offline durability), `competitive-gap-ledger.md`,
> `kill-switch-flip-packet.md`, `deploy-checklist.md`.

---

## ✅ Notebook close-out — 2026-09-23 (after G-064): four member-facing fixes, reviewed, gated, walked live

Owner delegation, verbatim: *"Approve fully everything on full judgement call by you."* Every call
made under it was recorded as a `Ruling:` in the session's scratch ledger (gitignored, not kept);
every one that changes what a member sees is summarised under **Decisions** below.

### What changed for members
1. **⛔ LIVE DEFECT, FIXED — the Ask question box on phones and tablets lost focus after every
   keystroke.** Verified on production 2026-09-23 (the owner's signed-in Chrome, a 386px same-origin
   iframe of `/journal/notebook`, touch tier matched): every keystroke moved focus to the Ask toggle
   behind the sheet, then to the sheet panel — on a phone that closes the keyboard after each
   character. **Mechanism:** `components/mobile/Sheet.jsx`'s focus effect was keyed on
   `[open, onClose]`; callers pass an inline `onClose`, so every parent render restored focus and
   re-focused the panel. **Fixed as a class in `Sheet.jsx`** (the latest `onClose` lives in a ref;
   the effect is keyed on `[open]`; drag-dismiss decides from a ref and calls `onClose` once, never
   inside a state updater) — so every one of the ~53 callers is fixed, including three the re-review
   found broken the same way: the COT symbol search, the hub's scrub slider and the nested
   indicator editor. (H14: the next deploy was blocked until the live build was checked; it was
   checked, and the fix rides in that deploy.)
2. **Paste never throws, never loses words, never wraps a member's paragraph** (pre-existing bugs).
   A partial copy spanning a Toggle threw `Called contentMatchAt on a node with invalid content` and
   the paste was lost; Callout/Toggle are `defining`, so a partial copy pasted at the start of a
   paragraph wrapped the member's paragraph in a new callout/toggle; a multi-line paste into a
   toggle's title split the toggle in two. One plugin now owns copy/paste for the three containers:
   `lib/pasteContainers.js` (`transformCopied` + `transformPasted` + a plain-text belt, and the
   toggle-title rules). Fuzz, 285,652 real pastes: throws 9,047 → 0 in scope, lost pastes 3,407 → 0,
   wrapped member paragraphs 9,816 → 0, lost nodes / toggle splits / flattened containers 0.
3. **Ask "This note" citations land on the passage** (pre-existing). The server and client citation
   text now equal ProseMirror's own `textBetween` (empty paragraphs, block atoms), positions count
   UTF-16 (a citation after an emoji was off by one per emoji), and an atom (attachment, excerpt,
   chart) is verified by its identity — issued only when unique in the note — never by its
   placeholder text. Measured over 68 citations: 10 no-op clicks on unedited notes and 31 after an
   edit → 0 and 0, with zero wrong-passage jumps in every combination. Ask "This note" is also
   8–98× faster on large notes (3,000 paragraphs: 4.47 s → 0.046 s).
4. **G-064 polish (still dark behind `NOTEBOOK_ASK_INSERT_ON`):** the picker focuses its search box,
   disables rows while creating, never sticks busy; a tap on a citation chip's own box always opens
   that chip's source, and every chip clears the 44px floor (measured in Chromium, WebKit, Firefox);
   the caret lands after an inserted answer, never inside it; export never raises on malformed ask
   attrs.

### Verification
- Every task: implementer → task review → fix rounds → scoped re-review; then a whole-branch Opus
  review (FIX FIRST: 2 Important, both closed) and a scoped re-review of the final wave (READY).
- Every new rail mutation-proved (red on the defect, restored by sha, green).
- **Gates, both six-shard, both at master `c7bddc046`:** master alone — 1,709 test files, 120 failing
  tests; the branch merged with it (`5974a7203`) — 1,725 files, 119 failing; both reconcile.
  `scripts/gate_baseline_diff.classify` (base = the master run): **0 branch-introduced failures** —
  the 4 rows it flags are the same four `| NC-A..D |` table rows `dailyFirstPaint` prints on master,
  differing only in timings (366 ms vs 382 ms). Records: `docs/notebook/gate-runs/g064-closeout/`.
  ⚠️ The committed `docs/plans/joystick/gate-baseline.json` (2026-09-14, 10 rows) is 130+ rows
  behind master. It was NOT re-adopted here: master's set includes message rows whose text carries
  timings, so adoption needs curation, not a copy — the two manifests are the measurement for
  whoever adopts it.
- **Live walk** — real Chromium (Playwright), the local sandbox
  (`scripts/hub_sandbox_boot.py --data-dir C:\data-g064 --port 8093`, `NOTEBOOK_ASK_INSERT_ON=1`),
  the built bundle, a 390px touch context, a synthetic sandbox account:
  - Ask's question box keeps focus through "what moved margins" typed key by key (the Sheet fix);
  - a summary→body toggle copy pasted with real Ctrl+C / Ctrl+V lands as plain text, no page error;
  - a partial callout copy pasted at a paragraph's start does not wrap that paragraph;
  - two lines pasted mid toggle-title keep one toggle, the title holding the joined text;
  - chips `[2][3]`: the left, middle and right of each chip's own box hit THAT chip.
  - `C:\data`: CLEAN at pre-boot / +15 s / +120 s, and 0 main `.db` files written through the stop
    (mtime check after a PID-exact stop). Result: `docs/notebook/gate-runs/g064-closeout/live-walk-2026-09-23.json`;
    integrity log `docs/plans/joystick/sandbox-runs/2026-09-23T12-16-46.md`.
  - ⚠️ The first two walk attempts reported the chips unhittable: the cinematic intro overlays every
    page load for ~9 s, and the probe ran under it. An instrument artefact, not a product fact.
- **Deploy:** recorded in the update to this section after the push.

### Wave 4 — the "known, not fixed" list, closed (same day, owner: "continue with anything remaining")
- **Charts citable one by one:** every widget embed carries its own `embedId` (stamped at creation;
  a pasted/dropped copy is re-stamped only on an id collision; a move or cut-paste keeps its id).
- **Long paragraphs** open WHOLE (`location.text_length`), not their first 400 characters.
- **Line breaks** read as one space in citation text on both sides; the 'İ' case-folding drift is gone;
  the Ask passage picker is lazy (identical results over 87,196 cases).
- **Drops** onto a toggle title follow the paste title rules; a drop that would throw lands as text
  (real-DOM sweep, 323,655 drops: 0 throws / lost / splits; old code: 2,354 splits).
- **Ask citations that used to do nothing now open:** an excerpt opens its passage (PDF at its page
  with the highlight, or the captured web passage) and a document opens at its cited page, in all
  four Ask hosts, through ONE opener (`lib/openCitation.js`); anything that cannot open says why
  INSIDE the Ask panel (visible on phones). A captured web page never reaches the PDF viewer from
  any door (this also fixed a live instance in "This note").
- **The gate itself:** `scripts/gate_shards.py` counts a FAIL line only when it names a test file
  (the dailyFirstPaint probes' own `FAIL | NC-…` report rows were being recorded as failures), warns
  when its count disagrees with vitest's, and `docs/plans/joystick/gate-baseline.json` is
  RE-ADOPTED from a six-shard run on master `51a61a8b8` (126 rows, 0 timeouts; was 10 rows while
  master failed ~124).
- **Gate on the landing tree `dac59bda5` (branch + master `51a61a8b8`): GREEN — NEW 0, exit 0**,
  1,741 files, 122 failing (all master's, baselined). `docs/notebook/gate-runs/g064-closeout/`.
- **Live walk on the wave-4 build:** the same five checks pass (Ask focus on phone, toggle-span
  paste, callout paste, title paste, chips); `C:\data` CLEAN, 0 writes
  (`live-walk-wave4-2026-09-23.json`, `sandbox-runs/2026-09-23T16-35-41.md`).
- Every wave-4 item: implementer → review → fix rounds → re-review → whole-branch review (READY).

### Known and recorded, NOT fixed (each ruled out of scope)
- An atom with no stable identity (a chart inserted BEFORE this deploy that shares its insert's id,
  a chip with no href) → its citation opens the note, never a sibling; two identical paragraphs can
  still be confused by a precisely sized edit (text-only verify).
- The research workspace's Documents list opens a captured web page's NOTE, not the captured-passage
  sheet (the research summary carries no capture passages).
- List-item copies with non-text endpoints can still throw on parse
  (programmatic only); a stale pre-deploy clipboard can hit the old parse throw once.
- The fingerprint "fast path" is computed and never compared (dead code).

### Decisions made under the delegation (full list in the session ledger)
- **Not built:** G-053 (Ask Notebook as Compass tools — a cross-workstream refactor), G-040 (already
  descoped by the owner), F5P-1 (its fix sits in the F5-frozen save path), K-1 (its measured
  precondition is not in hand). Legal/vendor items G-052/G-062/G-080/G-127 need outside parties.
- **Accepted behaviour change:** a whole foreign `<aside>`/`<details>` pasted from another site into
  an empty line becomes plain paragraphs, not a callout/toggle box (own whole-block copies still
  paste as a box).
- **Toggle-title paste rules:** text-only → one line in the title (marks and inline chips kept);
  anything with structure → lands whole after the toggle (before it at the start of a non-empty
  title); empty lines → no-op; a structure paste never touches the title's selection.

---

## ✅ G-064 build verification — 2026-09-23 (branch `feat/notebook-kill-switch`, built dark)

G-064 (insert an Ask Notebook answer into a note) is **built, reviewed and verified;
NOT merged, NOT deployed, flag NOT set.** Spec r2:
`docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md`; plan:
`docs/superpowers/plans/2026-09-22-ask-notebook-insert.md`. Every task went through an
implementer + task review (Opus on the editor/host tasks), then a whole-branch Opus review
and one scoped fix wave.

**Rails vs a baseline taken at `1a5473d19` before any code:** identical.
`reachable.test.js` lists only the two pre-existing names (`lib/context/focusDivergence.js`,
`pages/screener/shell/FilterBand.jsx`); tapFloor, tokens.reachable, themeIslands,
sourcesAreText, rawErrorSurface, f5Freeze, doorEnumeration, editorRawClasses green.
Backend scoped set: 667 passed, 1 failed — `test_feature_flag_ledger` naming only master's
undeclared `D2_DUAL_COMPUTE_WARM_READER_ENABLED` + `WISDOM_EXTRACT_PRESCREEN_ENABLED`.

**Six-shard gate** on `158112fa3` (branch + master `bab3f8b5c` merged):
`docs/notebook/gate-runs/g064/2026-09-23T04-42-22.md` — `GATE EXIT 1`, 137 "new" vs
`gate-baseline.json` (`1216958ed`, 2026-09-14, stale). **All 137 classified on a detached
`origin/master` `bab3f8b5c` checkout: 116 test-level failures fail identically on master,
2 file-level errors (Layout.pageTracking/routeSuspense) error on master, 19 are table rows
of one date-dependent chart test's message (fails on master). 0 attributable to this branch.**
⚠️ The gate baseline needs re-measuring on master — it is 8 days and 116+ reds behind.

**Live walk** — local sandbox (`hub_sandbox_boot.py --data-dir C:\data-g064 --port 8093`,
`NOTEBOOK_ASK_INSERT_ON=1`), real Chrome, built bundle. No model key in the sandbox, so
the Ask stream was answered by a canned SSE response injected into `fetch`; everything
downstream of the stream was the real app.

| step | result |
|---|---|
| In a note: Ask → "Insert into this note" | PASS — block "From Ask Notebook · Sep 23, 2026" appended at the end, chips `[1]`, `[1][2]`, button reads "Inserted" |
| Reload | PASS — server `bodyJson` holds `askInsert` + 3 `askCitation`; block re-renders |
| Edit the inserted paragraph | PASS — that chip reads `[1 · edited]`, name "…, text edited since inserted"; other paragraph's chips unchanged; `note only` precision word shown |
| Research Home → "Insert into a note…" → pick "Target note" | PASS — opens the note, answer appended after the member's text, hand-off entry consumed |
| Research Home → "Create a new note" | PASS — new note titled with the question, holding the block |
| Markdown export (`GET /notes/{id}/export`) | PASS — labelled quote with question, date, the member's later edit, and "Sources as of insertion" |
| Callout/Toggle styling (built CSS) | PASS — `.uctToggleChevron`/`.uctCalloutIcon` unhashed in the bundle; callout body flex/min-width, icon 18px, chevron borderless all apply; chevron **44×44** at 386px |
| Chip line height at 386px | PASS — chip `min-height 0`, 23.5px, `::after` hit area; lines stay 28.9px |
| `C:\data` integrity | CLEAN pre-boot / +15s / +120s (58 dbs, `docs/plans/joystick/sandbox-runs/2026-09-23T04-48-36.md`); 0 main `.db` files written through shutdown |
| Picker focus | NOTE — the picker's search box is not auto-focused when it opens (member clicks into it) |

**Open before `NOTEBOOK_ASK_INSERT_ON` is flipped (owner call):** the chip's touch hit area
can catch a tap meant for an adjacent run-together `[2][3]` chip; the picker search box is not
auto-focused. **Pre-existing, found by the reviews, not G-064's:** partial-copy pastes spanning a
Toggle throw in ProseMirror's paste fitting (the paste is lost); Callout/Toggle `defining` paste
wraps member prose in a new callout/toggle; empty-paragraph parity between the citation walkers
and `textBetween` remains open (the new re-resolution guard makes it fail safe).

---

## 🎯 2026-09-22 SESSION (later) — ledger status pass, 5 owner decisions, G-064 design

> ⚰️ **Corrected 2026-09-22 (G-064 build session), three sentences below were wrong:**
> - **G-053 is not "already honored".** No Compass chat tool reads `j2_notes`
>   (`coach_chat_tools.py` touches only `j2_trades.notes`), and Ask Notebook is its
>   own panel. It is an **owner decision**, not a closed constraint.
> - **The G-064 spec commit `39bc8fa2c` IS pushed.** It is on `origin/master`. The
>   spec is now at revision 2; see the plan
>   `docs/superpowers/plans/2026-09-22-ask-notebook-insert.md`.
> - **G-002's version-history UI exists.** There is a History button in
>   `NoteEditorPage.jsx` and routes in `journal_two.py`. "The member-facing UI
>   doesn't" was false.

**Read `competitive-gap-ledger.md` alongside this section — it is the master
G-numbered (G-001–G-128) tracking doc this session worked from.**

### What happened, in order
1. **Full ledger census.** Wrote and iteratively fixed a Python classifier
   that parses the ledger's actual STATUS column (position 10 of the
   pipe-delimited table) — caught and fixed my own false positive first
   (a naive keyword scan misread G-051's `**CLOSED (Wave K) — ... semantic
   leg open as G-127**` as OPEN, because "open" appeared later in the
   sentence describing a *different* row; fixed by anchoring on the row's
   first bolded token only). Result, cross-checked by direct reading:
   ~70 of ~89 active rows are DONE/CLOSED/SHIPPED/FIXED; the rest split into
   legal-gated (G-062, G-080, G-127, G-052), owner-ruling-blocked (G-040),
   platform-structural (G-044's iOS half), explicitly REJECTED
   (G-043/G-071/G-081/G-086), deliberately-deferred EXPERIMENT
   (G-017/G-082/G-085), and genuinely open engineering/design items
   (G-004, G-035, G-064 — G-053 turned out to already be an honored
   architecture constraint, not a build item).
2. **Walked Patrick through it** — full scope status, then a Patrick-only
   action checklist, then plain-language explanations of Tier 1/2/3 items
   (Tier 4 = "needs an outside party" was named but not explained in detail,
   since it needs Patrick's own action, not mine).
3. **Patrick's decision, verbatim:** *"G-004 YES, G-035 Agree leave it,
   G-074 yes turn it on, G-064 yes i want to build that properly, G-44
   whatever you recomend. Okay lets proceed."* All four immediate items
   executed same session; G-064 went through the full `superpowers:brainstorming`
   Architectural path (below).

### What actually shipped (all on `origin/master`, verified by ancestry)
| item | commit(s) | what changed |
|---|---|---|
| G-004 (encryption-at-rest) | `2d02e0e8d` | Accepted as answered — Railway infra encryption is real, no code change. Ledger row → DONE. |
| G-035 | `2d02e0e8d` | Kept OPEN, marked deliberate — owner-confirmed leave-as-is, ledger says so explicitly so it isn't silently re-opened later. |
| G-44 (iOS half) | `2d02e0e8d` | Marked PARTIAL/deliberately-deferred — Android already DONE; do not build a native iOS app for this row alone; the lighter fallback is already tracked as G-043 (bookmarklet), not a new idea. |
| G-074 (Awareness thesis-review scan) | `b689b063a` | **Real production flip.** `docs/feature_flags.json`: `AWARENESS_THESIS_REVIEW_ENABLED` `dark`→`armed`, `where: ["web"]`. Verified live in-process via `railway ssh` (not just `--kv`) — the scan reads the flag fresh every cycle, so it took effect within one 20-min APScheduler tick, no restart needed beyond the var-set redeploy itself. |
| (unrelated packets, merged in along the way) | `a9d6a29ab` | Clean merge of 8 disjoint upstream commits (Packets Q/P/O/N/M/L — admin panels, OpenFlow board, screener methodology, COT fixes, CLAUDE.md correction), verified non-overlapping via `git merge-base` before merging. |

**Push:** `96f8ea7af..a9d6a29ab`, ancestry-confirmed on `origin/master`. As of
this writing the branch (`feat/notebook-kill-switch`) is **0 behind /
1 ahead** of `origin/master` — the 1 ahead is the G-064 spec commit below,
**not yet pushed**.

### G-064 — Ask Notebook insert-into-note — DESIGN DONE, AWAITING OWNER REVIEW OF THE FILE

Classified **Architectural** per `superpowers:brainstorming` (new node types,
no existing "insert" flow to modify). Went through the full checklist: 5
`AskUserQuestion` rounds (scope = all four Ask Notebook scopes with a
note-picker · content = prose+citations preserved · visual = Callout-style
bordered block · edit behavior = permanent marking, per-citation staleness ·
picker = reuse the existing `[[` note-search pattern), two presented
technical-design sections both confirmed, then:

- **Spec written and committed:**
  `docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md`,
  commit **`39bc8fa2c`** (local to this branch, not yet pushed).
- **Self-review caught and fixed three real issues before presenting it**:
  (1) a genuine design contradiction — the draft named a `VITE_*` build flag
  but also claimed "no redeploy needed to turn off", which is false for a
  build flag; corrected to ride the **Wave K auth-payload mechanism**
  (`_access_payload` in `api/routers/auth.py`, read per-request, no rebuild)
  instead, working name `NOTEBOOK_ASK_INSERT_ENABLED`; (2) a fabricated
  citation (an invented "Wave P3 §36" tag) — replaced with an exact
  `file:line` quote after re-reading `AskPanel.jsx` directly; (3) a wording
  ambiguity in the insertion-point rule.
- **Two new TipTap node types**: `askInsert` (block container, styled like
  the existing `Callout`) and `askCitation` (inline chip, modeled on
  `noteLink`) — full attrs/shape in the spec §4.
- **⛔ PER THE BRAINSTORMING SKILL'S USER REVIEW GATE — DO NOT SKIP THIS
  EVEN THOUGH PATRICK ALREADY SAID "LETS BEGIN":** that approval was given
  in chat *before* the spec was written. The skill requires the owner to
  review the actual saved file before the next skill (`writing-plans`)
  is invoked. **This is the exact state to resume into:** Patrick has been
  asked to review the committed file and had not yet replied when this
  session ended.

### Immediate next action for the resuming session
1. Check for Patrick's response to the spec review (chat history, or ask
   again if none arrived).
2. If he requests changes: make them in
   `docs/superpowers/specs/2026-09-22-ask-notebook-insert-design.md`,
   re-run the self-review checklist (placeholder/consistency/scope/ambiguity),
   commit, ask again.
3. If approved: invoke **`superpowers:writing-plans`** (the *only* next
   skill on the Architectural path — never an implementation skill directly)
   to produce `docs/superpowers/plans/2026-09-22-ask-notebook-insert.md` (or
   similar), then execute it (subagent-driven or inline, per the plan's own
   handoff prompt). Ship G-064 **dark** behind `NOTEBOOK_ASK_INSERT_ENABLED`
   — building it does not mean activating it; that is a separate owner call,
   matching how every other capability this session touched was handled.
4. Push the G-064 spec commit (`39bc8fa2c`, currently local-only) — it's
   docs-only, safe to push any time, but wasn't yet pushed as of session end.

### Explicitly untouched, Tier 4 — not this session's to do
**G-062** (analyst-estimates legal review), **G-080** (share-link legal
review), **G-127** (semantic-search vendor ZDR confirmation) — all need
Patrick's own outside-party action (a lawyer, a vendor contact), correctly
not touched by this session since they were named as Tier 4 and were not
part of his five-item decision batch.

---

## ✅ 2026-09-21/22 SESSION — TWO WAVES PUSHED AND DEPLOYED

**Wave 1** fast-forward-merged to `master` at `60e73757b`, 2026-09-22T01:20:00Z
— §2/§3 below worked through (large-note import, editor writing, OCR,
share/templates/export, Ask panel, Obsidian import, connectors review).

**Wave 2** fast-forward-merged to `master` at **`29ccfae8c`**,
2026-09-22T01:43:46Z — a live production-flag correction
(`J2_SHARE_LINKS_ENABLED` ledger said "armed", live value was `0`, no
exposure, ledger fixed) plus a pass over `competitive-gap-ledger.md`'s own
OPEN rows: two (G-012 folder-sidebar leaf-row undercount, G-101 note-load
error state) turned out ALREADY FIXED in code and unverified — both proven
live against a real 1200-note sandbox / a real failed load; G-002 (version
history)'s "no table exists" claim was factually wrong (the table exists,
the member-facing UI doesn't — corrected, not closed); G-105 (5 raw
close-button glyphs) fixed and verified two ways in a real browser.

**Both waves verified three ways, not by a status field alone:**
`origin/production` ancestry (`git merge-base --is-ancestor`, after a real
`git fetch` — `git ls-remote` in a poll loop does NOT update local refs, and
this session tripped on that once, corrected in-place), Railway's own `web`
deploy record (`SUCCESS` on the exact SHA each time), and `/api/health`
`uptime_seconds` reset + held stable across follow-up probes each time.
`C:\data` confirmed untouched (content-hash, 58 DBs) across the WHOLE
session, including every real note/attachment/OCR/share/import/Ask/1200-note-seed
call made against the local sandbox, across both waves.

The 13 commits: the two original CSS floor fixes, and — worked through this
session, §2/§3 below, each with real local-sandbox evidence — the large-note
import killer (verified closed, already fixed in code, never proven until
now), one real fix (an internal-field-name error message rewritten to be
member-legible, reaching the editor + import wizard + all six connectors),
and full verification passes on attachments/OCR, share/templates/export, the
Ask panel, and Obsidian import, plus a code review of the six connectors.
Every phase's evidence is inline in its own §2 bullet below — read there
before re-deriving.

**Worktree:** `C:\Users\Patrick\uct-worktrees\notebook-k`. Tree clean at the
tip above; re-`git fetch`/`git log` before trusting this SHA if it's been a
while.

---

## ✅ WHAT IS LIVE AND VERIFIED ON THE DEPLOYED BUILD

Every row below was measured on production, not inferred from a passing test.

| what | evidence |
|---|---|
| **Graph layout no longer diverges** | On the deployed canvas at 500 notes: **0 lit pixels in the border band, wallX 0.00**. It previously pinned 98% of nodes to the frame and drew a rectangle with an empty middle. |
| **Graph canvas fills its container** | `attr_width 1501` against container `1501`, 2px unused (the border). Was stuck at the 820px default — 681px wasted. |
| **Label budget** | top-40 by degree. Was `degree >= 3`, which drew 291 labels at 500 notes with **54% overlapping**, and gave a 5-note notebook only 2 labels. |
| **`aria-pressed` on the five view toggles** | `"true"` read from the live DOM. Five icon buttons previously conveyed selection by CSS class alone. |
| **Touch floor, notebook surface** | phone **10 sub-44px → 2**, tablet **9 → 1**. Both survivors are global components (see below). |
| **`+ New note` no longer clipped** | Was 47px past a 390px viewport with *every* overflow check reading clean. |
| **Scroll performance** | 500 notes, 4,383 DOM elements: median **17ms** (60fps), 0 frames >50ms at tablet/desktop. |

### Verified working, no defect found
Search (case-insensitive, body text, multi-word AND, order-independent, prefix;
control returns 0) · backlinks ("LINKED FROM (n)", one row per source note,
`2x` badge only where refs > 1) · board and calendar with 40 notes
(8/8/8/8/8 columns; Sept 1 on Tuesday, today ringed, Unscheduled exact) ·
all five view modes at phone and tablet with **0 horizontal overflow**.

---

## 🔬 THE INSTRUMENTS — read this before trying to measure anything

### ⛔⛔ THE EXTENSION BROWSER CANNOT MEASURE LAYOUT OR TIMING

The Chrome driven through the Claude-in-Chrome extension reports
`document.visibilityState === "hidden"`. Its window is *visible and not
minimized* — Chrome's occlusion detection has it fully covered — and Windows
refuses `SetForegroundWindow` from a background process. Consequences, all
measured:

- **paint is deferred** → jank, frame timing and anything visual are meaningless
- **timers are throttled** → a loop of 40 × `setTimeout(60ms)` took >45s and
  killed the CDP call. Twice.
- **`resize_window` does not change the viewport** → `innerWidth` stayed 1920
  whatever was requested

⭐ **Use Playwright instead. It is already installed.**
`C:\Users\Patrick\AppData\Local\ms-playwright\chromium-1208\chrome-win64\chrome.exe`
It gives `visibilityState: "visible"`, exact viewports, real layout and paint,
and `page.route` interception *before the app boots* — which also removes the
SWR cache race that makes fetch-patching unreliable.

### `tools/mobile_audit.py` can now reach production

It looked for `MOBILE_AUDIT_EMAIL/PASSWORD`, which are not provisioned, while
`SMOKE_EMAIL/PASSWORD` are. It now falls back to them — that is the rule, not a
convenience: the smoke account is the only account automated tooling may sign in
as on production.

```bash
python tools/mobile_audit.py --base https://uctintelligence.com --auth \
    --viewport tablet --routes /journal/notebook
```

⚠️ `setx` writes to the user environment; an already-open shell does **not**
inherit it. Either open a new shell, or read `HKCU\Environment` in-process
(the probes below do this, so the secret never reaches a command line or a file).

⚠️ The bare route lands on "Continue working", where the toolbar does not exist.
Audit `?view=all` as well — the two page states have different controls, and
that is why the tool and a probe can legitimately disagree.

### Probes written tonight (scratchpad, not committed — recreate if useful)

`viewport_probe.py` (tap targets + overflow, NAMED) · `editor_probe.py` (the
editor at 3 widths) · `views_mobile_probe.py` (all five view modes) ·
`verify_tap_fix.py` / `verify_editor_floor.py` / `verify_skip.py` (before/after
on one loaded page) · `import_graph.mjs` (is a changed file reachable from a
test — answers the C2 question the carry-over tool cannot) ·
`graph_spread_sweep.mjs`, `graph_topology_test.mjs`.

⛔ **A probe needs a control or it proves nothing.** `import_graph.mjs` is run
against a test that *does* reach the file, to show the walker can find it.
The console reader emits a deliberate `console.error` to prove it is not blind.

⛔ **Dismiss the cinematic intro before measuring anything.** It plays on EVERY
page load and its ignition layer is **795px wide on a 390px viewport**. A first
pass measured the intro's geometry and attributed it to the editor.

---

## ⚰️ TRAPS HIT TONIGHT — do not re-pay for these

| trap | cost |
|---|---|
| **Heredoc eats backslashes** — `\\s` → `\s`, and in a template literal `\s` is a literal `s` | **3 times.** Corrupted a gate script, then broke a brand-new rail so it failed against CSS that was already correct. Write files with the Write tool or `python` + `chr(92)`; never a heredoc containing a backslash. |
| **Editing the tree during a gate** | `VERDICT=INVALID cause=TREE_DRIFT`. A wasted 30-minute run that says nothing about the code. |
| **Running probes beside a test suite** | 3 phantom reds in `doorsThroughTheEditor.property.test.jsx`. Passes 267/267 on a quiet box. One heavy thing at a time. |
| **`waitFor` expiry looks like an assertion failure** | Testing Library's `asyncUtilTimeout` is **1000ms** and `testTimeout` does not raise it. On expiry `waitFor` re-throws the *last* assertion, so a timeout and a real failure are indistinguishable from the message. A timeout is never banked. |
| **A "more spread" fix can re-break the thing you just fixed** | Widening 8 toolbar buttons on a 390px screen is exactly how `+ New note` went off the edge. Always measure overflow **and** floor together. |
| **Reasoning from the rule instead of the element** | Claimed `min-height` is inert on an inline `<a>`; the element computes to `display: block` and it works fine. The control caught it. |
| **Rediscovering a known record** | `CaptureHost.test.jsx` went red once. I classified it from scratch as load-sensitive — and `wave-q1-RESUME-HERE.md` already said *"CaptureHost resolved … load-sensitive by name, no fix"*. **Read the companion resume docs first.** |

---

## 📋 REMAINING WORK TO LAUNCH-READY

### 1. Land the four staged commits (owner push) — ✅ **RESOLVED, 2026-09-22**
Directly verified this session: the branch is 0 behind `origin/master`
(everything through `a9d6a29ab` is an ancestor). Whatever remained staged
here has landed. Continuing verification discipline forward — deploy by
artifact (`production` fast-forwards, `web` reaches SUCCESS on the SHA,
`/api/health` `uptime_seconds` resets against a pre-push baseline), never by
a status field alone.

### 2. Surfaces never audited — **the largest unknown**
Everything below is built and has tests, and **none of it has been opened at a
real viewport or exercised end-to-end this pass**:

- ✅ **the editor's actual writing experience — VERIFIED 2026-09-21**, real
  Playwright typing/formatting (Bold/H1/bullet list applied, confirmed landed
  server-side via the API, survives a reload) + the large-note-already-loaded
  case (903KB note loads in 1.17s/1730 paragraphs, stays responsive, growing
  it past the 1MB cap fails cleanly with a member-honest message and the
  draft-recovery banner genuinely restores the overflow text). One real fix
  landed (commit `0893b66e8`): the size-cap error was leaking the backend
  field name `body_json` to the member. **NOT covered**: tables, the slash
  command menu, undo/redo, touch-viewport typing — none exercised this pass.
- ✅ **attachments / hero image / OCR — VERIFIED 2026-09-21**, real Tesseract
  (`--ocr` armed on the local sandbox), a genuinely scanned-look PDF (Pillow
  raster, no text layer). Hero + inline image upload: clean. The real member
  path (toolbar "Attach a file" → inline chip in the body, not the raw API)
  through to OCR: extraction completed in ~0.4s, `textComplete: true`,
  `textOrigin: "ocr"`; the transcript is genuinely legible with normal
  Tesseract-typical minor misreads (expected, not a defect). Document search
  (`/notes/documents/search`) correctly finds the OCR'd text by two different
  query terms, with proper snippets, note linkage and `sourceKind`/
  `textOrigin` provenance — closes "cite". Clicking the inline chip opens a
  real `DocumentPreviewSheet`: the actual scanned page image, a "SCANNED
  TEXT" provenance badge, Open-in-new-tab/Download/Ask — closes "click
  through". The passive `DocumentTextStatus` disclosure banner in the body
  ("Text read from a scanned page. Check exact figures against the page.")
  is correct, honest, unprompted, and — this cost one round of confusion in
  testing — is NOT itself clickable by design (`role="status"`, no handler);
  attaching via the raw `/attachments` API instead of the toolbar button
  skips the inline chip entirely, which looks like a broken click-through
  and isn't one. **Not tested: real old-Safari pdf.js/Iterator crash class**
  (`CLAUDE.md`'s own section on this) — structurally invisible to Chromium,
  needs a real device.
- ✅ **share links / templates / export — VERIFIED 2026-09-21**, all real,
  no bugs. Share: created, resolved PUBLICLY with no cookie, real content,
  no owner-only fields leaked — and, the security-relevant check, a
  **revoked token is genuinely dead (404)**, not merely hidden from the
  owner's UI; a bogus token 404s cleanly too. (`J2_SHARE_LINKS_ENABLED`
  defaults OFF and is unset in the sandbox by design — confirmed **`armed`
  on `web`** in `docs/feature_flags.json` before testing, set it for the
  run.) Templates: the documented deep link
  (`/journal/notebook?new=thesis&ticker=NVDA`) loads in 1.4s and correctly
  seeds a real, well-structured thesis template (Bull/Bear case, Key
  assumptions, Catalysts, Risks). Export: Markdown download is real,
  correctly-formed (YAML frontmatter + proper heading hierarchy — the exact
  shape the import pipeline already round-trips per Phase 0); PNG download
  is a real non-empty image; Print button is reachable and doesn't crash
  the tab (the actual print output can't be observed headlessly).
- ✅ **the Ask panel — VERIFIED 2026-09-21**, real retrieval + real Claude
  synthesis (the sandbox has a live `ANTHROPIC_API_KEY`; not `--stub-ask`).
  A real question ("What is the stop price... and why there?") against a
  real note streamed a correctly-grounded, correctly-cited answer — the
  right figure, the right reasoning, `cited: [1]`, `invalidCitations: []`,
  streamed deltas concatenate to exactly the final answer. The complementary
  safety check: an unanswerable question gets the DETERMINISTIC refusal
  ("I couldn't find that in this note.", `noAnswer: true`, zero fabricated
  citations) — confirmed this never calls the model (by design, so a
  question the corpus can't answer never burns spend).
- ✅ **the import wizard — VERIFIED 2026-09-21 for Obsidian**, real folder
  picker, real vault (`.obsidian/` marker + a `[[wikilink]]` + a
  `![[wiki-embed]]` between two notes), through the actual wizard UI:
  auto-detect correctly identifies "Obsidian" (not generic markdown), and
  — the genuinely hard, differentiating check — **the `[[wikilink]]`
  resolved to a real cross-note link pointing at the target note's actual
  id**, no leftover `import-link://` placeholder. One non-bug found and
  understood: Obsidian inline `#hashtags` in body text are NOT extracted
  into `tags` — confirmed **by design** in the adapter's own header
  comment (tags come from YAML frontmatter only); my first fixture used
  the wrong style, not a product defect. **Not this pass: Notion, Evernote,
  docx, html** — each has its own adapter + unit tests (`notion.test.js`,
  `evernote.test.js`, `generic.test.js`) but no real-file, real-wizard pass
  yet.
- ✅ **connectors — CODE-REVIEWED 2026-09-21, not live-tested (structural
  limit, stated honestly)**: Roam/Craft/Notion/Dropbox/OneNote/OneDrive all
  need real third-party OAuth apps or graph tokens this local sandbox does
  not have — no amount of local tooling closes that, so this phase is a
  correctness review, not an end-to-end pass. What the review found: **474
  connector tests pass, run for real on this tree** (not merely present);
  zero stub/TODO/`NotImplementedError` markers in any of the six provider
  files; the double-gate (`note_sync` router mounts unconditionally,
  `NOTE_SYNC_ENABLED` gates only the scheduler) matches its own docstring
  exactly. The per-provider config-check pattern looked inconsistent at
  first (`_require_configured()` exists on Dropbox, not on the other five)
  — resolved by reading `oauth.py`: Notion/OneNote/OneDrive share ONE
  centralized, tested OAuth module (Dropbox self-contains its own for a
  documented historical reason — it predates that module — with an honest
  note that consolidating "just hasn't been done, not because the shape
  doesn't fit"); Roam/Craft are graph-token connect, so there is no
  platform-level config to check. My Phase 1 fix (the size-cap error
  message) structurally reaches all six too, since they share
  `import_confirm`.

### 3. A large document — ✅ **VERIFIED CLOSED, 2026-09-21** (was "a known killer")
`project_notebook_migration_wave0`'s record was itself stale: the actual root
cause was fully diagnosed in `docs/superpowers/phase-reports/2026-09-02-notebook-migration-adversarial-audit.md`
(findings A1/A2) and the fix landed in `notes.py::import_confirm` (per-note
`SAVEPOINT`, never a whole-batch rollback), `note_connectors/engine.py` (status
correctly reports `warning` only on genuine total loss, never masks a real
partial failure as `ok`), and `commit.js::runImport` (a failed batch no longer
`break`s the loop; a per-note `failed` entry renders as "Needs attention" with
the real reason). None of that had been proven against a *running* build —
this session did, three ways, on this branch's rebased tip:

1. **Server reproduction**, the audit's own shape (13-note batch, 1 oversized)
   via real HTTP calls shaped exactly like `runImport` sends: 9/9 checks pass
   — 12 siblings created, the oversized note named honestly in `failed`
   (`"body_json too large (>1MB)"`), idempotent on re-run (siblings skip, no
   dupes; the oversized note still fails, never silently vanishes), and the
   12 siblings are real, listable notes afterward.
2. **Real browser, real wizard, real file** — a 1.24MB single-file markdown
   import (2600 headed sections, the audit's own worst-case shape), through
   Playwright driving the actual `ImportWizard` UI on the local sandbox:
   client-side parse **0.30s** (no hang), server correctly rejects it
   (`Created: 0`), and the summary screen renders the honest member-facing
   copy verbatim: *"Some notes couldn't be fully imported: huge_trading_journal_v2
   — body_json too large (>1MB)... Nothing here is lost — running this import
   again retries only these notes."*
3. Confirmed `C:\data` untouched (content-hash compare, 58 DBs) through both.

**Not yet verified: the editor itself with a large note already loaded** (as
opposed to import) — that is Phase 1, next.

### 4. Real usage by the owner — **the highest-value item**
Every defect found tonight came from looking at realistic scale. Nobody but the
smoke account has used this. A morning of real use will surface a class of thing
no audit reaches.

### 5. Known, recorded, NOT fixed (each with a reason)

| item | why it was left |
|---|---|
| `/api/barspack/manifest` returns **401 twice on every notebook page load** | bars subsystem, not the notebook. No visible member impact. Flag to that owner. |
| **"Help & Feedback" 40×40** at ≤1024 | its block sets `40px !important` **and** uses `var(--tap-min)` on the rule directly below. The author knew the token and chose 40 for the corner FAB beside the voice orb. Another workstream's deliberate call; not ours to override for 4px. |
| **Graph clusters into ~55% of the canvas** | measured and dismissed. Sweeping `CENTER_PULL` moves occupancy 1–2% while raising wall pressure (4.1x → 5.0x). Topology A/B: uniform ~1 edge/node → 69%, realistic hubs+18% orphans → 55%, both flat across the knob. The clustering is the **data's** shape, which is why Obsidian looks the same. No tuning win exists. |
| **Graph resize re-lays-out** rather than preserving settled positions | needs layout/sizing separation; bounded and correct-looking as-is (one re-layout per gesture). |
| **Real-time collaboration** | weeks of work; wrong priority for a solo-trader notebook. |
| `focusDivergence.js` (R-29) | S4's workstream. |

### 6. Gate reality — **read before promising a green gate**
The six-shard gate has run **~14 times today**. It has never been green and is
not expected to be: the baseline is from **2026-09-14** and master has landed
many commits since.

- Today's reds ranged **31 → 57**, and **every single one was measured
  byte-identical at the merge-base** — i.e. master's, not the branch's.
- **ZERO reds under `journal-2-0` / `notebook` / `intro`** in every run.
- ⛔ **C2 of the carry-over rule is structurally unevaluable** — nothing in the
  repo emits the import graph it needs — so `tools/gate_carry_over.py` answers
  RE-GATE on every landing. A gate costs 25–35 min; master lands every ~20.
  **The loop cannot converge.** Record the evidence and stop, as CLAUDE.md's
  disturbance-interval rule says.
- The reds are **not banked** into `gate-baseline.json` deliberately: that file
  gives every entry an `owner`, and these belong to the pine/AST and screener
  workstreams. The byte-identical merge-base measurements are what their owner
  needs to bank them in one step.

### 7. Where the competitive bar actually stands

Feature parity is genuinely strong — five view modes (Notion's database views),
graph + backlinks (Obsidian), full-text search (Evernote), plus an offline
durability layer that is **ahead** of Evernote. The gap to "launch as a true
competitor" is no longer *features*; it is **confidence through use** and the
unaudited surfaces in §2.

---

## 🔒 STANDING RULES IN FORCE

- **Secrets** are never printed, logged, committed, or written to any file under
  the repo. Read `SMOKE_*` from `HKCU\Environment` in-process.
- **`smoke@uctintelligence.internal`** is the only account automated tooling may
  sign in as on production. It must never hold real state; whatever a run
  creates, it removes. **Never type a password into a browser field** — API POST
  from a script, or `tools/smoke_login_link.py`.
- **RESERVED:** flipping `NOTEBOOK_OFFLINE_DEFAULT_ON` (the kill switch) — never
  without the owner's word.
- **Never `git add -A`** in this shared worktree. Ship via
  `push origin <branch>:master`, **never force**.
- **Never `git checkout --` to undo a probe** — restore from captured bytes and
  verify the SHA.
- **R-CITE** every measured fact cites its artifact · **R-RAW** raw output before
  any summary · **R-HON** probe honesty first · **R-2** write files with the line
  endings git already stores (`python tools/check_repo_hygiene.py`).
- A **mutation proof** before any rail is trusted, and a **control** before any
  probe is believed.
