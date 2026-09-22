# Notebook — RESUME HERE (2026-09-20)

> **Read this before touching the Notebook.** It carries the state, the
> instruments, the traps, and the remaining work to launch as a real competitor
> to Notion / Obsidian / Evernote.
>
> Companion documents, still authoritative for their own scope:
> `wave-q1-RESUME-HERE.md` (offline durability), `competitive-gap-ledger.md`,
> `kill-switch-flip-packet.md`, `deploy-checklist.md`.

---

## ⛔⛔ THE FIRST THING: FOUR COMMITS ARE STAGED AND NOT PUSHED

Branch `feat/notebook-kill-switch`, worktree
`C:\Users\Patrick\uct-worktrees\notebook-k`.

| | |
|---|---|
| branch tip | `b71ef218e` (or later — re-read it) |
| commits ahead of master | **4** |
| tree | clean |

```
intro:  Skip had no touch tier, and it is on every page load
editor: the toolbar floor covered one axis and skipped its own neighbours
+ two gate manifests with their direction classifications
```

**A master push is Production Deploy and the owner runs it:**

```bash
cd /c/Users/Patrick/uct-worktrees/notebook-k && git push origin feat/notebook-kill-switch:master
```

⚠️ Master moves every ~20 minutes (pine + screener workstreams). Expect to
rebase before it lands. There is **zero file overlap** — this branch touches two
stylesheets.

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

### 1. Land the four staged commits (owner push) — **blocking**
Then verify the deploy by artifact: `production` fast-forwards, `web` reaches
SUCCESS on the SHA, and `/api/health` `uptime_seconds` **resets** against a
baseline captured *before* the push. Never by a status field alone.

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
- the **import wizard** (Notion / Obsidian / Evernote / md · docx · html)
- **connectors** (Roam, Craft, Notion, Dropbox, OneNote, OneDrive — shipped dark)

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
