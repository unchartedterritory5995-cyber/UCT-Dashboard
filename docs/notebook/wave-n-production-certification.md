# Wave N — Evidence Completion: production certification

**WAVE N — EVIDENCE COMPLETION: CLOSED IN PRODUCTION.**

---

## The exact record (§27)

| | |
|---|---|
| branch range | `cd78148ab..ab0ea82a1` on `notebook-primary-platform` |
| reconciliation | master had advanced **32 commits**; **zero file overlap** with Wave N's 30 changed files |
| merge | `136a50c0f` — ordinary merge of `origin/master` into the branch, no conflicts, **no force push** |
| **master commit** | **`136a50c0f0c95e8869a53f201dad5be1badecf8c`** (`f4aeb7e3d..136a50c0f`) |
| **deployed commit** | **`136a50c0f`** — verified identical to the tree every check below ran against |
| serving entry BEFORE | `/assets/index-DmCmxceK.js` |
| **serving entry AFTER** | **`/assets/index--mdoeee9.js`** |
| fresh process | `uptime_seconds` **73** at first green health check (reset from 329) |
| `broker_sync` in `api/main.py` | **10** (locked floor 7) ✅ |
| asset sweep | **288 assets, COMPLETE** |
| machine headroom at merge | 232.59 GB free (was 0.16 GB — see the disk section) |

⛔ **Deploy success is not fresh version serving.** Both were required and both
were observed: the entry hash moved AND the process restarted. The pod returned
`502` mid-swap for ~70s, which is the swap, not a failure.

---

## Route / auth verification (§11)

Unauthenticated, against `https://uctintelligence.com`:

| surface | result |
|---|---|
| `GET /api/j2/notes/{id}/evidence-candidates` | **401** |
| `POST /api/j2/notes/{id}/evidence` | **401** |
| `GET /api/j2/notes/{id}/thesis-summary` | **401** |
| `GET /api/j2/excerpts/{id}` | **401** |
| `POST /api/j2/capture` | **401** |

⭐ **The control is what makes those 401s mean something.** A route that is NOT
mounted falls through to the SPA: `GET /api/j2/notes/{id}/there-is-no-such-endpoint`
returns **200** (HTML) and the same path via POST returns **405**. Both were
measured in the same run. 401 is therefore *mounted and gated*, not *absent*.

---

## Asset sweep (§10)

**288 assets swept, verdict COMPLETE**, walked from the cache-busted entry
`index--mdoeee9.js` and following both chunk-specifier forms. The walker's
sanity floor (`< 20 assets ⇒ PARTIAL`) did not trip.

All seven Wave N markers land in the code-split Notebook chunk
`NotebookTab-GsQtspBf.js`:

| marker | proves |
|---|---|
| `not the whole article` | §9 captured-source view's coverage line |
| `Open the source` | §9 publisher link |
| `source no longer available` | §10 purged-source degrade |
| `Search your captured passages` | §12 picker search |
| `search to narrow` | §12 honest cap line |
| `Evidence added as` | §14 attach announcement |
| `already attached` | step 1 duplicate state |

⚠️ **One marker was rejected mid-verification and replaced.** `"most recent"`
matched `OptionsFlow-D8dzISgw.js` — its own unrelated copy. Generic English is
a coincidence, not evidence; the marker is now `"search to narrow"`, which
lands where it should. A marker that matches the wrong chunk proves nothing and
was not counted.

---

## Behaviour verified at the exact deployed commit (§12, §13, §15–§19)

The worktree was confirmed byte-identical to `origin/master` (`136a50c0f`),
rebuilt, and driven through the **fail-closed sandbox** — never production data.

**Flagship 14-step journey: every step green.**

```
picker   Captured passage · Reuters: NVDA margins (reuters.com)
thesis   OPPOSES · cuts against the long case — Captured passage · Reuters… (reuters.com)
revisit  Reuters: NVDA margins / reuters.com / CAPTURED PASSAGE / <passage> /
         "This is the passage you kept — not the whole article." / YOUR NOTE / Open the source
duplicate  picker: "· already attached", disabled   API: 400 "already attached to this thesis"
PDF §8   real 47-page upload → candidate sourceKind=attachment, pageNumber=47 →
         attaches → thesis shows p.47 → viewer opens with its document actions
Ask      ONE source: "Reuters: NVDA margins · captured passage 1"  (no p.1)
```

**Mobile / a11y (§19): no findings**, 390×844 coarse pointer, picker OPEN.
Every control ≥44px and hit-tested with `elementFromPoint`; the attached row
renders whole (57px, two lines) and still names `reuters.com`; no horizontal
overflow (390/390); `Evidence added as opposing.` in a polite live region;
focus restored to `BUTTON: Add evidence`; already-attached conveyed in words
AND disabled.

**Backend rails at the deployed commit:** export / lifecycle / duplicate /
lineage / capture-kind — **67 passed**. Merged-tree Wave N sweep — **285
passed**. Journal 2.0 frontend + master's new shared util — **211 files, 2,152
tests, 0 failed** (`--maxWorkers=4`).

⛔ **What was NOT exercised, stated in exact words (§12, §15):** the member-rendered
Wave N flow was **not** exercised in production with a live member session.
There are no safe production credentials and seeding real Notebook data to
manufacture one would pollute member research. What is proven instead is the
three layers §12 asks for, separately:

- **A.** the serving backend mounts the candidate/evidence/excerpt contracts and
  gates them (401 vs the 200/405 control);
- **B.** the serving frontend carries the Wave N picker and rendering logic
  (7 markers, correct chunk, COMPLETE sweep);
- **C.** the **exact deployed commit** is green in the fail-closed member-facing
  E2E sandbox, including Ask, mobile and a11y.

This is the same limit Waves L and M recorded. It is not rounded up.

---

## ⚠️ The instruments were wrong five times before they were right

Four during branch work (recorded in the closure doc), and **four more during
this release verification** — every one of which reported a *product* defect:

1. The capture probe waited on `[role="status"]`, which the Compass tip also
   carries, so it returned on somebody else's element while the dialog still
   read "Saving…" — and the next line reported *"the captured passage did not
   land as ONE candidate: []"*.
2. `"Document excerpt"` was checked against the whole page; it is also the
   picker's own type-button label, so it fired whenever the picker was open.
3. The attach probes (E2E and mobile) waited a fixed 1.2s/1.5s. On a cold
   sandbox that read mid-write and produced **three findings at once** — no
   announcement, focus on `<body>`, no attached row — all of which were the
   write still being in flight.
4. The mobile harness **crashed while printing its own findings**: a quoted
   page string contained `⌘` and stdout was cp1252. The diagnostic worked on
   every green run and died on the only kind of run that matters
   (`lesson_a_capture_that_only_breaks_on_failure`).

All four are fixed in `a5d5b59af` and commented where they happened. **Both
attach probes now wait for the edge to exist rather than for a stopwatch.**

---

## ⚠️ The disk, and what is still exposed

The release was blocked at §31 step 2 with **0.16 GB free of 499 GB**. Cause,
measured: **23 abandoned `data_sync_*` directories holding 230.8 GB** — R2 bars
snapshot staging that leaks whenever the process is force-killed before its
`finally: rmtree`, which is how every browser verification ends. 201.4 GB of it
predated this session's work.

Reclaimed with owner approval: **230.82 GB**, plus 1.6 GB of leftovers from
software idle 823 and 1,247 days. **0.16 GB → 232.59 GB free.** Only
positively-identified paths were touched; nothing else on the machine.

Fixed forward in `ab0ea82a1`: `tools/local_backend_sandbox.py` never turned off
`USE_REMOTE_BARS`, so every sandbox boot pulled the multi-GB snapshot into a
fresh empty `DATA_DIR`. It is now in the OFF list, railed by
`tests/test_local_sandbox_is_cheap.py` (18 tests, 2 mutations) — including the
control that `USE_REMOTE_BARS` really is the variable `api/main.py` branches on.
**Verified live: the sandbox booted for this certification and free space held
at 232 GB.**

🔴 **STILL EXPOSED — `tools/e2e_sandbox_launcher.py` has the same defect.** It
derives its env from `audit_sandbox_env.sandbox_env()`, which redirects
datastores but turns off no heavy jobs, so `USE_REMOTE_BARS` passes through
from `.env`. A run of it during this very certification created a **new 24.86 GB
`data_sync_lscxhj3m`**. It belongs to another workstream and another session was
live in the repo, so it was **left alone deliberately** rather than edited. The
fix is the same one line — add the heavy-job OFF set, `USE_REMOTE_BARS` first.

🔒 `C:\Program Files\LGHUB.old` (0.49 GB, idle 551d) needs an elevated shell;
not self-elevated.

---

## Residuals carried forward, un-inflated

1. 🔴 **Inherited red, proven pre-existing:** `test_obsidian_parity_fixtures` —
   7 stale Obsidian fixtures. Reproduces with pre-Wave-N `conftest.py`; no Wave N
   commit touches `note_connectors/`. **The repository is not green**; the Wave N
   scope is. Fix is the test's own named generator command.
2. **Ask's coverage line did not render** in the flagship run (`ask-coverage`
   empty). Not a claim this wave made; worth a look.
3. **Per-item `coverage` is CORRECT PLUMBING, NOT A NEW SHIPPED FEATURE.** It is
   right everywhere and no new member-facing consumer was established for it.
4. **Stance change is remove-then-add**, not in-place editing. Current product
   semantics, recorded — not redesigned during release.
5. **The picker cap says "showing your 50 most recent"** — the endpoint exposes
   no total and one was not invented.
6. **§16 competitor AI source-counting rows remain NOT ASSESSED.**
7. **Performance:** picker p50 **12.0 ms** / p95 13.0 ms on a **240-capture**
   corpus, real HTTP. Sufficient evidence of no obvious interaction latency at
   the measured sample — **not** all-scale certification. The instrumentation
   lesson stands: `localhost` cost ~2,050 ms per call on this machine and made
   every operation identical; an invariant measurement across fundamentally
   different operations is presumptively an instrument defect.

---

## G-080 and the standing gates — untouched

- `J2_SHARE_LINKS_ENABLED=0`. Nothing in this wave touches note sharing, public
  share links, or their authorization.
- No embedding call, no ZDR gate change, no semantic env flag. Semantic stays
  **DARK**.
- Every new query is tenant-scoped inside the SQL; the duplicate guard runs
  **after** the ownership check so it can never become a cross-tenant existence
  oracle.
- No raw private note content added to logs.
- Account deletion clears evidence, excerpts, documents and notes.
- **No real member research was touched** at any point in this release.

---

## Product state after Wave N (§28)

**Before:** a captured passage was accepted by the thesis-evidence API and the
member could not select it.

**After:** the member discovers it, sees the source and their own annotation as
two distinct things, attaches it, records a stance, is prevented from
duplicating it, sees it rendered truthfully in the thesis, revisits the deepest
truthful source, and asks over their research without it being counted twice —
on desktop and on a phone, with the real-document path unchanged.

⛔ **Wave O — Finance-Native Review Loop is NOT started** (§29).
