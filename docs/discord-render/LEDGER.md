# Discord Render Hardening — Program Ledger

Program home: `docs/discord-render/`. Branch: `discord-render-hardening`
(worktree `C:\Users\Patrick\uct-worktrees\discord-render`). Started 2026-09-13 (Sunday).

**Scope:** every Discord command that produces a chart image or an options-flow render and
delivers it into Discord — `/chart` · `/c` · `/charts` (retired, handler live) · `/flow` ·
the chart-message controls (buttons/select) · the `/flow` "View chart" popup · `/buzz` (board
image). Scheduled image posts that share the same renderer (index-close, buzz digest) are
mapped as **capacity neighbours**, not rebuilt by this program.

## Standing rules this program runs under (read before any merge)

| Rule | Source |
|---|---|
| ONE master merge at a time, repo-wide. Railway `web` SUCCESS **and** the running SHA confirmed before the next. | CLAUDE.md (owner, 2026-09-13) · `docs/runbooks/deploy-windows.md` |
| Everything ships DARK behind a flag. The owner flips. | program brief |
| flow-worker watched files: after-hours/weekend only. Any red from `tools/flow_worker_watch_coverage.py` gets an ADDITIVE / BEHAVIOUR-CHANGING classification **in this ledger** before the push. | `docs/runbooks/deploy-windows.md` |
| `chart-renderer` has NO repo source — no push deploys it. A renderer change is its own deploy (`railway up`), gated like flow-worker: what it serves, whether a restart drops in-flight renders. | deploy-windows "Current state" |
| Partner-owned files (`OptionsFlow.jsx`, `live_massive_router.py`, `schwab_router.py`): minimal isolated diffs, noted per row. | CLAUDE.md · memory `project_partner_collab_branch` |
| Backend pytest is SCOPED (named files), never repo-wide. One gate at a time on this box. A run with no totals line is not a run. | CLAUDE.md |
| Every master push carries a plain-English member-impact paragraph (in the row below). | memory `feedback_master_push_needs_explicit_deploy_and_member_summary` |
| Same file edited / same command re-run more than twice → stop, write the loop here, change approach. | program brief |

## Merge ledger

One row per commit on program paths. `Running SHA` is read from the deployed service, never
inferred from a CLI exit code.

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|

## Owner decisions (OI-xx)

Each: the question, my recommendation, what I proceeded on. The owner overrides before the flip.

| OI | Question | Recommendation | Proceeding on |
|---|---|---|---|

## Loop log

(Empty. Any file edited or command re-run a third time for the same purpose is recorded here with the change of approach.)

## Phase summaries

(Written at each phase boundary.)
