# RESUME — Notebook 10/10 program, wave 7 — checkpoint 2026-09-25 13:20 CT (G and I closed; H and J in their fix rounds; whole-branch review next)

This is the checkpoint for **wave 7** (capture & mobile · performance · AI + editor · hardening).
Waves 5–6 have their own checkpoint, `docs/notebook/wave5-6-RESUME-HERE.md`, and it still
governs the two OPEN PRs (#186, #193) — read it for those. `docs/notebook/RESUME-PROMPT.md`
is the paste-ready prompt for the whole program.

Bare-minimum one-liner: "Resume the Notebook 10/10 program at wave 7 — read
`docs/notebook/wave7-RESUME-HERE.md` in `C:\Users\Patrick\uct-worktrees\notebook-w7` first,
then the SDD ledger it names, then continue exactly where §5 says to."

## 1. Where things stand, measured 13:20 CT

| what | where | state |
|---|---|---|
| wave 7 branch | `feat/notebook-w7`, worktree `C:\Users\Patrick\uct-worktrees\notebook-w7` (owner file present) | tip `42ef504f2`, pushed; dirty files are lanes H and J mid-fix-round |
| base | `5f60d5d5b` = the wave-6 checkpoint tip (`feat/notebook-w6`) | wave 6 is NOT yet merged into wave 7 — do it once the lanes are quiet (§5 step 6) |
| lane G (capture & mobile) | image OCR + docx documents, personal API, iOS Shortcuts doc, email-in — all DARK behind `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` / `NOTEBOOK_PERSONAL_API_ENABLED` / `NOTEBOOK_INBOUND_EMAIL_ENABLED` | **CLOSED** at `09bc51ecb`: build `b0aaa2c41..de4d1dedf` → task review → fix round 1 `a4f157a95..37ceae2da` → re-review ALL ADDRESSED + one new Minor → fix round 2 `09bc51ecb`, verified by the controller |
| controller wiring for G | `48373b67c` (mounts, Settings cards, boundary rail, door ledger ⑤, single-process note), `04b5d484e` (hygiene rail reads its capture ONCE + personal-API case) | landed, pushed |
| lane I (performance) | search rewrites + indexes, budgets tool + hand-edited `docs/notebook/perf-budgets.json`, advisory `.github/workflows/notebook-budgets.yml`, lazy highlighter/views, one vite `build` key | built `7f8f24056..d53e0f0d4` → task review (spec PARTIAL on numbers, honest; 0 Critical / 1 Important / 9 Minor) → fix round 1 `8531f317c..eb645d08a` incl. ruling D-I1 (vendor-echarts removed) → re-review 4 open → fix round 2 `576213b14..8d34a5fdf` → **CLOSED**, the controller's own scoped re-check (27 py + the tag-follow rail green; 3 mutations red, restored to the report's hashes) |
| lane H (AI + editor) | H1 dictation + G5 Scan door `7d20f97f9`; H2 writing help `d5b62f592`, `5beafa181`; H3 meaning search DARK `90f6f160f`; H4 Compass `search_my_notes` text-only DARK `a871ddf60`; ask correlated-EXISTS fix `7daf14b57`; M-3 `2064d8029` M-4 `e7ea9e54a`, M14 `db4d0cb1c`, M5 `80541eff5`, M-9 `b14dfca1e` | DONE_WITH_CONCERNS → task review PASS / 0 Critical, 7 Important, 11 Minor (`wave7-H-review.md`: unbounded armed search + 500 on embed failure, sweep held the write lock across the vendor call, abort refunded the 60/day, silent mic drop, hub write-door declaration, M14 race → J9, harness A/B owed) → **FIX ROUND 1 RUNNING** (I-5 `8c9aba1fa`, I-2 `42ef504f2` landed so far; the readAt clean-up added as an addendum); controller wiring `593447621` (mount, gzip exemption, semantic sweep every 15 min max_instances=1, single-process entry) landed |
| lane J (hardening) | J1–J10 `94bc9f1f8..a59f4ff36` (bridges pin the root, `finally`, media byte budget, DERIVED deletion manifest, valid saved-view row, href stripping, ticker_research EXISTS, `{note, changed}` on PATCH tags with `moved := changed`, chunked-rename detail, the 39 baseline AuthContext-mock reds from master's `7ac9ff5ce`) | DONE_WITH_CONCERNS → task review PASS / 0 Critical, 2 Important, 9 Minor (`wave7-J-review.md`: GATE RISK — the bridges' ~6.5 s conftest import × per-test spawns against a 15 s timeout → spawn once per file under a 60 s budget; a behavioural rail for the trigger-emptied FTS tables) → **FIX ROUND 1 RUNNING** |
| CLAUDE.md | `28da814ce` points at the perf-budgets record | landed |
| PR #186 (wave 5) | head `d8846006c` | MERGEABLE, waits on the owner's `gh pr merge 186 --squash`; full-suite verdict classified in its body (honest delta vs master's own run = 2 rows, both classified) |
| PR #193 (wave 6) | head `e9a87394c` | **CONFLICTING** with master on ONE file (`usePreferences.additionsOnly.test.js`); GitHub runs no PR CI on a conflicting head; resolved by the planned post-#186 merge of master into `feat/notebook-w6` |

## 2. Blockers

- **None on the code.** Two agent seats are in use (lane H, lane I's re-review); lane J waits for one.
- **Owner-gated:** `! gh pr merge 186 --squash` → deploy watch → master into w6 → re-gate → `! gh pr merge 193 --squash`. Also M-10 (locked notes ruling; the new doors refuse 423 meanwhile), the Privacy sentence for email-in, Cloudflare Email Routing + worker secret, the BrowserStack device run (mic + `capture="environment"` Scan + HEIC), OpenAI zero-retention before semantic search, and the email-in limit values (20/40 per hour, 50/100 MiB per day; see the Discord queue).
- **The account rate limit** killed both running agents at ~10:4x CT (reset 10:50); both were resumed from their transcripts by `SendMessage`, nothing lost (every checkpoint was committed and pushed). If it trips again: wait for the reset, resume by message, never spawn fresh.

## 3. Rulings this wave (`wave7-rulings.md` in the SDD workspace)

D-G1..D-G4 (new server doors refuse locked notes 423; personal tokens `client_type="personal_api"`, 365 d, one-time; image/docx behind a NEW dark gate; email-in = Cloudflare, dark, Privacy sentence drafted only) · D-H1..D-H4 (askInsert gains `action`/`model` attrs, no schema bump; writing help own 60/day counter; semantic search dark until zero-retention; Compass notes tool TEXT ONLY, flag read per call) · D-I1 (drop `vendor-echarts`: +580 KB on Calendar/Research/MyStocks to save ≤7 KB on 93 routes) · M-7 stays (never widen `sourceKind`; the raw `kind` field is separate, `575eff414`).

## 4. Numbers that are NOT met, recorded rather than hidden

From lane I's report and review (loaded box: the runs overlapped a live trading session):
search p95 < 100 ms at 50k is missed on the common-term pair (146.5), the search box's relevance
request (293.5, was 561 s), the tag pair (124.6) and the untouched switcher; typing is 17.6 ms/char
at 1,000 ¶ and 22.4 at 2,000 against a 16 ms line; `list_tasks` 188.7 vs 150. `perf-budgets.json`
never had a latency line raised; the bytes line moved only by measurement. Lane H's bar is
therefore NO REGRESSION against those numbers, and lane H's `90f6f160f` changed how `GET /notes`
routes queries — its task review must re-measure the search-budget ops through the new routing.

## 5. Exact next actions, in order

1. Lane I re-review verdict (`wave7-I-fr1-re-review.md`) → adjudicate → close lane I or fix round 2 (resume the lane I agent by message).
2. Lane H hand-back → `review_package.py` over its commits → task review (opus) with the lens: no schema bump, dark gates unchanged and False when unset, the I-HOOK append never bypasses `list_and_count_notes`, the search ops re-measured, the harness readings before/after each editor addition, `capture="environment"` Scan to G's spec, 60/day counter own.
3. Controller wiring for H, in one commit with its rails: mount `api/routers/notebook_writing_help.py` (prefix `/api/j2`, own dark gate) in `api/main.py` BEFORE `journal_two` the way `notebook_insights` is (route-order rail); add the writing-help SSE path to `_is_gzip_exempt` (`/api/j2/notes/{id}/writing-help/stream` — GZip would buffer the stream) with its test row; schedule `note_semantic.run_sweep` under `semantic_enabled()` like the wave-6 reminders job; the writing-help 60/day counter joins the single-process list in CLAUDE.md if it is in-process.
4. Dispatch lane J (`wave7-J-brief.md`) when a seat frees; J7 only after lane I closes.
5. Whole-branch review (opus, most capable model), ONE fix dispatch, scoped re-review.
6. Merge `feat/notebook-w6` into `feat/notebook-w7` (lanes quiet); then, if #186 has landed, master into w7 as well (ours on squash-induced conflicts; the one known conflict is the preferences opaque-key map — take master's, re-add MemberTemplates).
7. Six-shard gate in a BRANCH-NAMED gate worktree (`git checkout -B notebook-w7-gate <sha>`; `node_modules` junction to `notebook-k`, removed with a non-recursive delete only), never in the implementer's worktree.
8. Wave-7 walk (`tools/notebook_wave7_walk.py`, from the wave-6 walk; sandbox data dir passed from PowerShell; a PAID walk account) on the final tip; evidence committed before interpretation.
9. PR: body carries the member-impact paragraph, the HMAC deviation for email-in (`"<timestamp>.<raw body>"`), the known limits (within-window replay, D-G1(b) fork, no plan re-check), the flip checklist (G's I-1..I-4 + N-1 fixed; the limit values for the owner; zero-retention for semantic search), the never-revert list, the CI classification. Owner merges.

## 6. Background processes

None of this wave's tooling runs unattended. Lane I's sandbox (`C:\data-w7perf`) and its 2.4 GB seeds were deleted in its fix round; lane H booted `C:\data-w7Hperf` for its baseline (a real directory — check `Get-Item -Force` before any delete). `C:\data` was CLEAN at every checkpoint both lanes reported.

## 7. Verification checklist after a restart

```sh
git -C C:\Users\Patrick\uct-worktrees\notebook-w7 log --oneline -3        # tip, on feat/notebook-w7
git -C C:\Users\Patrick\uct-worktrees\notebook-w7 status --porcelain       # only a running lane's edits
git -C C:\Users\Patrick\uct-worktrees\notebook-w7 rev-parse origin/feat/notebook-w7   # == HEAD once pushed
dir C:\Users\Patrick\uct-worktrees\notebook-k\.superpowers\sdd\2026-09-23-notebook-10  # the ledger (§8)
gh pr view 186 --json mergeStateStatus,headRefOid ; gh pr view 193 --json mergeStateStatus,headRefOid
```

## 8. ⛔⛔ The SDD ledger is LOCAL DISK ONLY

`C:\Users\Patrick\uct-worktrees\notebook-k\.superpowers\sdd\2026-09-23-notebook-10\` is gitignored:
`progress.md` (the ledger), `OPEN-ITEMS.md`, `DISCORD-QUEUE.md`, `wave7-rulings.md`,
`wave7-dispatch-plan.md`, every `wave7-*` brief, report, review and package. Not recoverable from
git. Never `git clean -fdx` there; never remove the `notebook-k` worktree without backing that
directory up first.

## 9. Standing rules — pointers only

`CLAUDE.md` at the repo root holds them; the ones this wave leaned on: at most 3 agents including the
integrator (measured as 2 lanes + controller here); master is production, never pushed directly, one
master merge at a time; TDD + a mutation proof per rail with bytes restored by sha; pathspec commits
only, and `git commit -F - -- <paths>` in a worktree another agent is active in (the INDEX is shared);
tests in their own call before the commit; `check_repo_hygiene.py --staged` with the staged COUNT read
(it is vacuous when nothing is staged); a test run without a totals line is not a run; the F5-frozen
offline files are nobody's; nothing writes under `C:\data`.

## 10. Gotchas specific to this checkpoint

- A read-only reviewer that mutates-and-restores makes a lane's file show dirty for a minute; it is
  not a second implementer. Read `git status` twice before concluding.
- A mutation that ERRORS at import is not a proof — read "failed" vs "error" on the totals line.
- The full-suite workflow compares feat branches against a FIXED 2026-09-15 baseline; the honest
  delta is against master's own newest completed run (see #186's body for the method).
- GitHub creates no `pull_request` run for a CONFLICTING head; #193 has none by that mechanism.
- `gh pr edit` must run from inside a git checkout; a scratchpad cwd fails "not a git repository".
