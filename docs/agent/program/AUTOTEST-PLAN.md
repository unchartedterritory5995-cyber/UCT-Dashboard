# UCT Agent autotest: plan (REAL-MODEL not run, not authorized)

**Status, 2026-11-05.** Built and dry-run only. No paid call has been made. Paid runs need the owner's authorization file, and a run can never pass $8.

## Scope
Goal: Claude finds, reproduces and fixes Agent failures before the owner sees them. Each request is typed into the real Agent panel and graded from the resulting component state, never from a receipt. Rig: `app/src/testing/agent/autotest/`. Gate: `tools/agent_autotest_gate.py`.

| Mode | UI | Model | Proves | Does not prove |
|---|---|---|---|---|
| SIMULATED | real panel, jsdom | scripted | a plan runs on the fixture board | anything about a browser or a model |
| BROWSER-MOCK-MODEL | real Charts, headless Chrome | scripted | the plan executes on real components | that a model picks that plan |
| REAL-MODEL | real UI, local harness or production | real | a real model's behaviour on these requests | see below |

Every output file and line carries its mode. A request a mode cannot run reports as not run, never as a pass.

## Request set
| Set | Requests | Turns | Measured model calls (scripted) |
|---|---:|---:|---:|
| Public: 29 capability families, 66 inventory rows | 246 | 270 | 199 |
| Held out: sealed, written by a separate author who never read the public set | 68 | 81 | 63 |
| **Total** | **314** | **351** | **262** |

Public kinds: phrasing 89, params 35, target 25, followup 19, combo 8, multistep 7, invalid 31, unsupported 16, how-to 16. How-to and explain requests that match the instant path cost nothing.

Held-out requests exist in the repository only as ciphertext. The key is outside every worktree (`~/.uct-agent-autotest/heldout.key`). A held-out result leaves the process as id, family, kind, pass or fail, and layer, with no words, plan, checks or screenshot. Do not give the key to a fix worker. The file does not stop a worker on this machine who goes looking for the key: the rule does.

## Oracles
Each request states its expected target, parameters, confirmation card and Undo. Requests can also state persistence, read-back, refusal, a clarifying question or a walkthrough. Tutorial grading checks that the ring sits on the real control and that the control can be hit. It also checks the instruction's words and runs the workflow by real clicks. Failures get one of 12 root-cause layers and are deduplicated into families. The layer is a rule-based first sort, not a proven cause. A failure folder holds the request, plan, state before and after, and a screenshot.

Not checkable: the exact shade of a colour word, the picture of a chart style (checked as a pixel change only), the wording of prose, and whether a read answer is good advice. Each request lists its own gaps in `unverifiable`.

## Cost and stages
Per-call figure: **$0.016**, taken from the 2026-11-03 production run ($0.64 over 41 calls = $0.0156) and the planner v2 plan's $0.016 per v1 turn. That is claude-haiku-4-5 on planner v1. The real model's call count may differ from the scripted count above.

| Stage | Requests | Model calls | Expected | Ceiling |
|---|---:|---:|---:|---:|
| canary | 12 | 9 | $0.14 | $0.50 |
| sample | 90 | 70 | $1.12 | $2.00 |
| broad | 144 | 120 | $1.92 | $3.00 |
| heldout | 68 | 63 | $1.01 | $1.50 |
| **Total** | **314** | **262** | **≈ $4.19** | **$7.00** |

The remaining $1.00 under the $8 limit is an unassigned margin. Each stage must be named in the authorization file, and the owner sees each stage's results before approving the next. The cap per turn stays $0.25 and the limit per request stays 2 calls. Neither is changed.

## Stop rules (enforced by the gate)
Every call reserves its worst case in `tools/agent_eval_ledger.py` first and settles the actual cost after. Dollars per call and per turn are recorded in `spend.jsonl`.

A run refuses or stops at the authorization's `max_usd`, the stage ceiling, the ledger's cumulative cap or the per-turn cap. Ceiling refusals are stops too.

**Sticky stops**, which only the owner clears by deleting `C:/UCT/agent-autotest-STOP.json`:
- any ceiling above
- a call over its own worst case
- a turn over $0.10
- a mean over $0.05 after 20 paid turns
- a response with no usage
- two calls ending in refusal or max_tokens
- three API errors in a row
- on production, a write off the allow list or any change to protected state

## Production target (built, never run)
The owner signs in by hand to an isolated Chrome with a temp profile. No Claude session sees a password or cookie. Runs use one disposable layout named `AUTOTEST-<run>`.

**Must never be touched:** UCT Default, Main Trading, the owner's other layouts, watchlists, price and indicator alerts, drawings, saved templates, screens and definitions, and any preference other than the three workspace preferences.

**Rails:**
- 127 of the 246 public requests are safe to send. The rest are never sent, because they write outside the test layout.
- Network interception refuses every page write not on the allow list, and that stops the run.
- Protected state is fingerprinted by sha256 before and after.
- A `finally` block restores the preferences and deletes the test layout.

Production outputs are value-free: no axis text, widget faces, screenshots or panel text printed. Production runs on the production key and the owner's $5/day budget. The eval ledger still counts each turn, reserved at $0.25 and settled from `/api/agent/budget`. `/api/agent/budget` is a whole-day figure, so settling assumes no other Agent use during the run.

## What the results can and cannot prove
**Can:** whether this model, on these flags, handles these 314 requests on these boards, and what each one cost. Held-out pass rate against public pass rate shows how far fixes generalize.

**Cannot:**
- that the Agent works for phrasings outside the set
- anything statistical from one run: no repeat runs are budgeted, so one flaky request can decide a family
- production behaviour from the local target, which uses fixture lists, synthetic bars, a stand-in conversation store and planner v1, with the data kinds off
- behaviour on real data, or on any viewport but 1500 by 900
- planner v2 or other production flags, unless they are set for the run

The browser clock is not pinned, so anything that depends on market hours varies by time of day. Session requests avoid this by running on intraday charts.

## Owner approval needed
1. **Budget:** a maximum at or under $8, and which stages.
2. **Eval key:** `UCT_AGENT_EVAL_API_KEY` in the run's environment, separate from production, with a provider-side spend limit.
3. **Ledger cap file:** `C:/UCT/agent-eval-cap.json`. It does not exist, so the ledger refuses everything until it does.
4. **Authorization file:** `C:/UCT/agent-autotest-authorization.json`, written by the owner:
   `{"approved_by":"owner","max_usd":8,"expires":"YYYY-MM-DD","targets":["local"],"stages":["canary"],"public_set_sha256":"<run.mjs --lint>","heldout_sha256":"<run.mjs --lint>"}`
5. **Production, separately:** add `"production"` to `targets` and the exact `production_ack` sentence from `realGuard.mjs`.
