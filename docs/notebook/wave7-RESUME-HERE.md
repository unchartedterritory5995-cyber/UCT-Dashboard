# RESUME — Notebook 10/10 program, wave 7 — checkpoint 2026-09-25 17:25 CT (all four lanes closed; whole-branch review done; the whole-branch fix round in progress)

This is the checkpoint for **wave 7** (capture & mobile · performance · AI + editor · hardening).
Waves 5–6 have their own checkpoint, `docs/notebook/wave5-6-RESUME-HERE.md`, and it still
governs the two OPEN PRs (#186, #193) — read it for those. `docs/notebook/RESUME-PROMPT.md`
is the paste-ready prompt for the whole program.

Bare-minimum one-liner: "Resume the Notebook 10/10 program at wave 7 — read
`docs/notebook/wave7-RESUME-HERE.md` in `C:\Users\Patrick\uct-worktrees\notebook-w7` first,
then the SDD ledger it names, then continue exactly where §5 says to."

## 1. Where things stand, measured 17:25 CT

| what | where | state |
|---|---|---|
| wave 7 branch | `feat/notebook-w7`, worktree `C:\Users\Patrick\uct-worktrees\notebook-w7` (owner file present) | tip `2082a414e` (84 commits over base), pushed; dirty files are the two fix implementers mid-item |
| base | `5f60d5d5b` = the wave-6 checkpoint tip (`feat/notebook-w6`) | wave 6 NOT yet merged into wave 7; dry run CLEAN at `e9a87394c` (§5 step 6) |
| lane G (capture & mobile) | image OCR + docx documents, personal API, iOS Shortcuts doc, email-in — all DARK | **CLOSED** at `09bc51ecb` (review → R1 → re-review → R2, controller-verified) |
| lane I (performance) | search rewrites + indexes, budgets checker + hand-edited `perf-budgets.json`, advisory CI job, lazy highlighter/views, one vite `build` key, D-I1 | **CLOSED** at `8d34a5fdf` (review → R1 → re-review → R2, controller-verified) |
| lane H (AI + editor) | dictation + Scan, writing help (DARK), meaning search (DARK), Compass `search_my_notes` (DARK), carry-overs | **CLOSED** at `e6bb581a5` (review 0/7/11 → R1 → re-review: 0 Critical, 0 Important; its two Minors settled by D-H5 and the D-H1 addendum) |
| lane J (hardening) | J1–J10 | **CLOSED** at `730153a60` (review 0/2/9 → R1 → re-review ALL ADDRESSED) |
| controller commits | wiring `48373b67c`, `04b5d484e`, `593447621`; docs `28da814ce`, `4c4f4006a`; rail `35fe1367e` | landed, pushed |
| wave-7 walk | `tools/notebook_wave7_walk.py` `03f07b9bd`, 30 checks | phase 1 DONE (W14–W18 PASS on `4c4f4006a`; sandbox integrity CLEAN ×4); phase 2 on the final tip |
| whole-branch review | four shards (backend, frontend, tests, tooling), synthesis `wave7-whole-branch-review.md` | **0 Critical, 8 Important, 34 Minor**; every item ruled and in `wave7-branch-fix-list.md` (57 lines) |
| whole-branch fix round | BACKEND implementer (api/, tests/) + FRONTEND implementer (app/src/) in parallel; a small TOOLING fix after both | **IN PROGRESS**: frontend has landed H N-2/N-3, J N-1, I-1 (lazyChunk everywhere under journal-2-0), I-2 (caret after Accept) |
| PR #186 (wave 5) | head `d8846006c` | OPEN, waits on the owner's `gh pr merge 186 --squash` |
| PR #193 (wave 6) | head `e9a87394c` | OPEN, CONFLICTING with master (one test file); resolved by the post-#186 merge of master into w6 |

## 2. Blockers

- **None on the code.** Two agent seats are in use (the two fix implementers).
- **Owner-gated:** `! gh pr merge 186 --squash` → deploy watch → master into w6 → re-gate → `! gh pr merge 193 --squash`; then wave 7's PR. Flip preconditions for the dark gates (none is needed for the merge): M-10 (locked notes ruling; new doors refuse 423 meanwhile); the Privacy sentence for email-in; Cloudflare Email Routing + worker secret + a **WAF Skip rule for Browser Integrity Check on `POST /api/j2/inbound-email`** and a first-message test while dark (the worker's UA-less POST is otherwise blocked — NOT VERIFIED on the live account); OpenAI zero-retention + vendor terms before semantic search; the email-in limit values; the BrowserStack device run (mic + Scan + HEIC); delete `C:\data-w7walk` by hand after the walk.
- **The account's session limit** killed running agents twice today (~10:4x, ~14:5x CT). Every checkpoint was committed and pushed; agents were resumed by `SendMessage`. The second hit also killed a reviewer that had overflowed its own context on a 1.9 MB package — hence the sharded review.

## 3. Rulings this wave (`wave7-rulings.md` in the SDD workspace)

D-G1..D-G4 · D-H1..D-H4 (+ the D-H1 addendum: no schema bump ⇒ an older bundle MISLABELS provenance) · D-I1 (drop `vendor-echarts`) · D-H5 (per-action writing-help cost estimate) · D-H5b (ONE durable daily counter in auth.db for the shared LLM $ cap, writing help's 60/day and the embed count) · D-H6 (meaning search: per-member single-flight, query-vector cache, daily embed count; fail open) · D-G5 (a clean open editor re-reads on focus/visible; fall back to wording if an F5-frozen file would have to change) · D-H7 (writing help refuses inside an Ask answer) · D-H8 (the client renders meaning rows and an honest count) · M-7 stays (never widen `sourceKind`).

## 4. Numbers that are NOT met, recorded rather than hidden

From lane I's report and review (loaded box: the runs overlapped a live trading session):
search p95 < 100 ms at 50k is missed on the common-term pair (146.5), the search box's relevance
request (293.5, was 561 s), the tag pair (124.6) and the untouched switcher; typing is 17.6 ms/char
at 1,000 ¶ and 22.4 at 2,000 against a 16 ms line; `list_tasks` 188.7 vs 150. `perf-budgets.json`
never had a latency line raised. Lane H's same-window A/B found NO REGRESSION BEYOND NOISE (its
earlier "improvement" claim was withdrawn). The armed meaning search fell from ~6 s to ~21 ms at 50k
blocks after lane H's round.

## 5. Exact next actions, in order

1. Backend + frontend fix hand-backs → package each → ONE scoped re-review of the whole fix round.
2. TOOLING fix dispatch (after both; it places doc wording both decide): email-in-setup.md's BIC skip-rule step + first-message test + 403 diagnosis; the CI latency flap (breach only on reproduce); the `NOTEBOOK_SEMANTIC_PROVIDER` ledger row; the benchmark census rail and the workflow-advisory rail (surviving mutations A, B); `--base` identity check; the D-G5 wording in personal-api.md / ios-shortcuts.md / email-in-setup.md; perf-budgets provenance; fail-closed bytes check; harness log location.
3. Controller: CLAUDE.md single-process list (after D-H5b: remove `_writing_help_by_user`, name the durable counter, add `_inflight`, the PermitPools, D-H6's single-flight + cache); the D-G1(b) ruling wording; this file.
4. Merge `feat/notebook-w6` into `feat/notebook-w7` (dry run clean). Master into w7 only after #186 lands; at that merge take master's two AuthContext-mock test files (master fixed them in `521351f21`; J10 becomes redundant) and re-run the dry run for the preferences opaque-key map.
5. Six-shard gate in a BRANCH-NAMED gate worktree (`git checkout -B notebook-w7-gate <sha>`; `node_modules` junction to `notebook-k`, removed with a non-recursive delete only), never in the implementers' worktree.
6. Walk phase 2 on the final tip: the walk author first fixes W13's integrity evidence (tooling I-2: reuse the harness's `read_integrity` + `--shutdown-wait`), then runs; evidence committed before interpretation.
7. PR: member impact, rollback, flip checklist per gate (incl. the BIC rule), known limits, the NOT-met numbers, the whole-branch review summary, CI classification (flow-worker watch: INERT STRAND). Owner merges after #186 and #193.

## 6. Background processes

None of this wave's tooling runs unattended. All lane sandboxes and seed data were deleted by their lanes except `C:\data-w7walk` (the walk's; reused for phase 2, then deleted by hand — the agents' delete tool refuses root-level paths). `C:\data` read CLEAN at every checkpoint every lane and the walk reported.

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
