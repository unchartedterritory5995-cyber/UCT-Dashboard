---
id: WISDOM-SESSION-15
title: Session 15 — the volume root, the forced-run guard, the budget knob, four dead weekly steps, and a PR GitHub will not create
status: complete — 4 authored commits, 1 sync merge, $0.00. PR NOT created. NOT merged. INGEST NOT lit.
---

# Session 15 — the window opened, and the PR was the thing that would not

> **PR #1 created: NO.** · **merged: NO** · **deploy SUCCESS: N/A** · **dark 401: not run** ·
> **INGEST lit: NO** · **entity master seeded: NO**
> **SPEND on extraction $0.00.** No gate run, no extraction API call, no key read.
> **Ledger byte-identical** — 5,406 bytes, sha `b182b329`, 28 entries, `31.481462 / 100.0`.

⛔⛔ **THE BLOCKER MOVED, AND IT IS NOT THE ONE ANYONE EXPECTED.** Session 14 stopped at the
guard's burst clause. **This session's merge window OPENED on the first probe** — recency and
burst both clear at 19:34:19. What stopped it instead: **GitHub will not create the pull
request.** The form submits and the server answers

    There was an error creating your PullRequest.

⭐ **The control settles that it is not my doing.** I submitted the form **completely unmodified**
— GitHub's own default title, empty body, nothing touched — and it errored identically. There are
**no rulesets on `master`** (Settings → Rules: *"You haven't created any rulesets"*), so branch
protection is not it either. Six attempts across two sessions, four distinct approaches
(`type`, `form_input`, a plain click, an untouched form).

⚠️ **The most probable cause, stated as a hypothesis and not a finding:** the compare is **86
commits / 78 files**, and the page sits on *"Checking mergeability… Don't worry, you can still
create the pull request"* for a long time. A create that races that computation is the shape that
fits. **`gh pr create` would print the actual API error**; `gh` is absent on this box, and that is
now the single tool that would unblock this.

---

## What landed (Step B — all four items, pushed)

### R56 — the persisted-runs root moves onto the volume

`reconcile.DEFAULT_ROOT` was `Path("data")/"wisdom"/"gate-runs"` — CWD-relative, no override, and
no way for the chain to pass one. On the pod that is `/app/data/wisdom/gate-runs`: an **ephemeral
image layer**, not the volume.

⛔ **The consequence was never "a wrong directory".** `MIN_RUNS = 3` needs three passes to
**coexist**, so a chain-side N-pass writing there would have accumulated nothing, forever, while
every chain step reported `ok`. Now `gate_runs_root()` — `WISDOM_GATE_RUNS_DIR`, else
`<DATA_DIR>/wisdom/gate-runs`, DATA_DIR defaulting to `/data`.

**Two second-order traps closed, and both are the same lesson twice:**
* there is **deliberately no module-level constant**. It was a default ARGUMENT, and Python binds
  those once at import — any constant would freeze the environment as it stood then, so a
  rehearsal pinning `DATA_DIR` afterwards would be silently ignored;
* the path was defined **twice** — in the module that writes runs and the module that discovers
  them. The PC-side tool now has an explicitly different `LOCAL_ROOT`, because on a dev box
  `<DATA_DIR>` is the live `C:\data` that `out_path` refuses outright, so defaulting to the chain
  root would make the gate tool refuse to start.

Mutation: reintroduce the CWD literal → **8 of 10 red**, including the AST check.

### R57 — and four weekly steps that have never run

`chain.py` named `extract.run_weekly_audit`, **which does not exist**. `resolve()` returned None,
the step recorded `not_available` — a skip, not a failure — so the weekly extraction audit had
never run once. Only the name was wrong; `extract.run_audit` is the implementation both
`RUNBOOK.md:108` and `CONTRACTS.md:251` specify.

⛔⛔ **Then the rail found three more.** `evals.reconcile_weekly`,
`core.vocab.refresh_candidates` and `publish.adapters.refresh_voice_profile` are **not implemented
anywhere in the repo**. **Four of the seven weekly steps resolve to nothing.**

⭐ Those three are genuinely **unbuilt**, not misspelled — `not_available` is the right status for
them, and neither deleting the steps nor building three unruled features was mine to do. They are
declared in `KNOWN_UNBUILT` with a reason each, plus a second test that fails if one is
implemented and left on the list. The distinction the rail enforces: a **typo** fails by name, a
**gap** is a line somebody had to write.

Mutation: put the wrong name back → 2 red by name.

### R52 (Q-3) — force no longer bypasses the switch that spends

Both entry points read `if not ctx.force and not flags.extract_enabled()`. `force` is a **query
parameter** on an admin route, so the one switch that costs money was one request from not
applying. Now `spend_allowed()` / `spend_refusal()`, shared by `run_daily` **and** `reap` — they
carried the identical bypass, and mutation 2 proves fixing one would have left the other.

The deliberate door: `WISDOM_EXTRACT_ACCEPT_SPEND` must equal an **exact literal**, case-sensitive
(a switch satisfiable with `=1` is one somebody sets meaning something else), and it grants nothing
without `force`, so it cannot become a standing grant in a shell profile.

Mutations: drop the acceptance → **10 red**; fix only `run_daily` → 2 red.

### R53 — the daily budget knob, default $25

`WISDOM_EXTRACT_DAILY_BUDGET_USD`, read from exactly one place, **a value and not a switch**.
Unset takes the ruled default; **present-but-unusable refuses** rather than falling back, because
`=25O` quietly becoming 25.0 is how somebody ships a night they did not authorise. Zero refuses
too and the message names `WISDOM_EXTRACT_ENABLED` — zero is not a pause button.

⭐ A test recomputes the default rather than trusting it: 400-request ceiling, N=3 → 133 × 3 = 399
requests × $0.06139 p90 = $24.49, rounded up. **The nightly bill is fixed by REQUESTS, not by N** —
N changes coverage per night, not what a night costs.

Mutation: make the garbage case fall back silently → the load-bearing test reds.

---

## What did NOT land, and why

**B4 — the N-pass build.** R56 unblocked it and the doors are now known (`submit_pending`'s `salt`
and `segment_rows`; without a per-pass salt, pass 2 computes the same `custom_id` and is silently
counted `skipped_not_retryable`). It was not built: the session's remaining budget went to the
four items above and to six PR attempts. **It is the largest single remaining piece.**

**Steps C–F** — merge, verify, INGEST, seed — are all downstream of a PR that does not exist.

---

## 1. MUTATION-PROOF

- `git status --porcelain` clean; `origin/feat/wisdom-loop...HEAD` = 0 0.
- **4 authored commits + 1 sync merge.** Off-limits diff EMPTY on every authored commit.
  `app/` **0 files**, non-wisdom `api/` **0 files** — checked on the merge tip.
- **Master never pushed from this box.** `is-ancestor(HEAD, origin/master)` = **FALSE**.
- **Production-state changes: NONE.** No PR, no merge, no Railway variable, no seed, no flag.
- **Ledger byte-identical**: 5,406 bytes, sha `b182b329`, 28 entries, `31.481462 / 100.0`.
- **The probe log**, every reading timestamped: session 14 — 18:50:16 through 18:56:19, twelve
  probes, cadence REFUSE throughout (recency 600 s, then the burst clause: 3 distinct web deploys
  in 60 min). Session 15 — **19:34:19, `OK/OK`, window OPEN on the first probe.** The merge did
  not happen inside it because the PR could not be created, not because the window closed.
- **No attestation variable set.** `UCT_BURST_ATTESTED_BY` / `_AT` untouched — master's R19 defines
  them as a named person at a named minute, and a session cannot see other sessions.
  **No `--no-verify`.**
- **Railway CLI: reads only.** No `variables --set`, no `ssh`, no value printed.
- **Browser: github.com only**, logged in as the repo owner. Read-only except two field writes on
  a compose form that never submitted successfully, plus the create attempts themselves.
  Settings → Rules read once, to establish that branch protection was not the blocker.
  **No credential entered, no OAuth prompt touched.** ⚠️ Screenshots still time out on this
  extension; page state was read from the DOM throughout, as the brief directs.
- Local scheduler untouched. Member data NONE. D16b not read.

⭐ **Three instrument errors made and caught this session**, all the same family:
1. asserting `is_absolute()` on `/data/...` — **false on Windows**, where an absolute path needs a
   drive. The test was reporting a property of the box as a property of the code; `.root` is the
   cross-platform predicate and now carries a control;
2. hunting the literal `run_weekly_audit` across a whole document, when this fix's own history note
   has to contain it — the CODE-NEVER-PROSE trap, scoped to the table row it is actually about;
3. the same trap again in the R52 rail, solved by reading the boolean from the AST rather than the
   file's text.

## 2. TOTALS

| | |
|---|---|
| API calls / spend | **0 / $0.00** |
| tests | R56 10 · R57 6 · R52 17 · R53 8 = **41 new rails**, all green with the suites they touch |
| mutations | **6**, every restore byte-exact and sha256-verified |
| commits / merges / pushes | 4 authored / 1 sync / 3, branch only |
| probes / wait minutes | 13 / ~6 (session 14) + 1 / 0 (session 15 — open immediately) |
| PR create attempts | **6** across two sessions, 4 distinct transports, all refused server-side |

## 3. QUESTIONS FOR PATRICK

**Q-1 ⭐⭐ the PR cannot be created, and `gh` is the tool that would say why.** Six attempts,
including a completely unmodified form. No rulesets on master. The compare is 86 commits / 78
files and the page dwells on *"Checking mergeability…"*. Either install `gh` (then
`gh pr create --base master --head feat/wisdom-loop` prints the real API error), or try it by hand
— it may simply succeed from a warm page. Everything else is ready: the full local gate is green
on the tip, and the merge window was open.

**Q-2 ⭐ four weekly chain steps have never run.** One was a typo and is fixed. The other three —
`reconcile_weekly`, `refresh_candidates`, `refresh_voice_profile` — are unbuilt. Build, or delete
the steps? They are declared in `KNOWN_UNBUILT` either way, so nothing is silent now.

**Q-3 — the N-pass build is unblocked but not built.** R56 landed; `salt` and `segment_rows` are
the doors. It is the largest remaining piece and wants a session of its own.

**Q-4 — pair 30**, carried: *take* vs *watchlist* the obvious stocks, graded Y at low confidence.
The only one of the 42 that would move if you read it the other way.

**Q-5 — the EXTRACT checklist**, current state:
budget default **$25 — SET** · Q-3 forced-run guard — **committed, not deployed** ·
N-pass on the volume — **root landed, pass-loop NOT built** · entity master — **UNKNOWN, fails
closed and invisibly** · one INGEST night observed — **pending, and gated on the PR**.
