# Studio track: the plan, beside the Pine full-parity programme

FINAL v8, 2026-11-15. v8 adds the two commitments the owner asked for and v7 did not
have: section 13, how the whole ecosystem looks and is reached by a member, and section 14,
how it gets measurably better every week. It also corrects decision D16, which had been
written without reading the authoring owner's own staged-rollout proposal.

v7 is a review of v6 against the repository one day later: it
changes no direction, it corrects what v6 stated wrongly or left unowned, and it names the
one thing that was silently blocking four lanes (the requests in section 6 had never
reached master). Every v7 change is listed in section 11. History: v1 was reviewed the same day by four independent reviewers (engine
fit, security and cost, product and member experience, adversarial delivery); v2 carried
their findings. v3 corrects a miss that neither v1, v2 nor any reviewer caught: plain-English
indicator authoring ALREADY EXISTS in this repo (section 1a). Section 11 lists every change
and why. v4 adds the census in section 9: a second look found the formula reference page,
the published-formula library, share links and indicator templates already live, so the rule
from here on is CENSUS BEFORE DESIGN (decision D13). The owner delegated every open decision;
the rulings are in section 8. v5 adds section 9a, a ledger of what was MEASURED on
production (how well the existing pieces work, what is wrong, who fixes it) and lane S-L.
v6 adds section 12, the resume point.

This repo is public. Only this plan and generated engine references are committed. The
competitor review that informed it, and the competitor's own documents, stay local.

Read with:
- `_resume-2026-11-01/PINE-FULL-PARITY-PLAN.md` and `AGENT-RULES.md` (the programme and its
  rules, which every lane here inherits unchanged)
- `docs/pine/SESSION-STATE.md` (engine state; re-read `scriptEngineVersion.js` on master for
  the current number: 54 when v1 was written, 57 one day later. Three versions a day is the
  cadence every number in this plan has to survive)
- `docs/pine/EDITOR-STATUS-PANEL-SPEC.md` (the built, dark status panel)

## 1. What is being built, and who owns it

| product | what it is | owner |
|---|---|---|
| A. Pine parity engine | Any open-source TradingView script runs and draws the same | The Pine programme (waves W0-W9 + E) and its engine sessions |
| B. Pine Screener | One script evaluated across a list of symbols | Server lanes: the programme (W5). Member surface: this track |
| C. Indicator ecosystem | Authoring help, a reference, an inspector, sharing | This track. The programme's mockup 3.1 draws a `[Studio]` tab and CONSOLE / REFERENCE / PORT tabs with no spec behind them |

This track never edits the engine. Its lead over the reviewed competitor is the engine's
verdict: every surface shows what the engine says about a script, never what a model says.

## 1a. Plain-English authoring already exists: build on it, do not build beside it

`docs/indicators/PLAIN-ENGLISH-AUTHORING-2026-11-01.md` and `AGENT-M3-CONTRACT.md` describe it;
the code is `app/src/components/chart/builder/studio/` and `builder/authoring/`.

- **Create Indicator (UCT Intelligence):** a chart-docked conversation panel. Conversation ->
  interpretation -> live preview on the real chart -> refinement -> save, with Undo, a
  per-tab preview channel and a session that outlives the dock.
- **How it works:** the model emits a structured, validated PATCH (`uct.authoring.patch/1`)
  over the canonical engine. The browser applies it atomically (canonical check, node
  allow-list, evaluate, hash round-trip, repaint refusal) and reads the result back in words
  computed from the definition, never from the model's prose. Saving uses the ordinary door.
- **Two server doors:** `POST /api/user-definitions/converse` (the full builder, behind the
  `create-indicator` cohort gate or admin) and `/propose` (one formula column).
- **UCT Agent** reaches the same layer; one layer, two callers.
- **State:** dark. A per-browser switch (`window.__uctCreateIndicator(true)`) plus
  `CREATE_INDICATOR_COHORT_ENABLED`, recorded in the ledger as pending since 2026-10-07.

This is a stronger design than the reviewed competitor's, which has a model write code and
trusts the model's summary. Here the model cannot make the chart differ from what the
read-back says, because the engine does the maths and writes the words.

**Consequence for this track.** v1 and v2 planned a new dock (S2) and a model that writes
Pine with a repair loop (S4 + S5). Both would duplicate this layer with a weaker design.
They are withdrawn. What the competitor review contributes is applied TO this layer, as
requests to its owner (section 6), and the largest single lever is not a build at all: it
is rolling out what is already built.

## 2. The boundary

**Engine-owned, READ-ONLY for this track:**
`app/src/components/chart/engine/**`, `app/src/components/chart/builder/**` (the Builder, the
Pine tab, the status panel, `memberPane/`, `SharePanel.jsx`, `editorStatusGate.js`),
`api/services/ast_*.py`, `api/services/pine_*.py`, `scriptEngineVersion.js`, capture queues,
the vendor harness, the census.

**Studio-owned (new, so no merge collisions):**
`app/src/components/studio/**`, `api/routers/studio_*.py`, `api/services/studio/**`,
`docs/pine/studio/**`, and its own flags.

**Shared files, one-line additive edits only, batched into at most one `[studio]` change a
week:** the mount point of the inspector panel (S3, decision D14), the route entry for the
screener surface (S6), `Dockerfile.web` + `docs/feature_flags.json` (flags),
`persistenceManifest.json` (storage keys), the palette entry.

**Pages this track may change by pull request, for their owner's review:**
`app/src/pages/formulas/**` (the reference and library pages). They are not engine-owned.
The placeholder fix (ledger U4) already works this way, and S2' does too.

**Asking the engine for something:** a row in `requests.md` at the repo root, picked up by
the Pine coordinator. Never a direct edit to an engine-owned file, never an engine version
bump. Open requests are listed in section 6. A request exists only once it is ON MASTER: a
row on an unmerged branch has been asked of nobody (decision D15).

**Reading the engine:** only through existing exports. Studio derives, never restates.

**Studio's reference never fails an engine change.** The check that the committed reference
is current is opt-in (`STUDIO_MEASURE=1`) and run by the Studio session. The reference
carries the engine version it was built at and the app shows that number.

**Machine rules:** AGENT-RULES unchanged. One heavy job at a time through the lock, targeted
vitest files with a low worker count, a sparse worktree (`app`, `tools`, `docs/pine`, `api`;
about 400 MB as measured) with a junction to the shared install, branch pushes only. Fake-verdict unit tests
stay engine-free and fast so they never queue behind an engine run for long.

## 3. One vocabulary

The status panel's headline, verbatim from `editorStatus`, is the ONLY verdict a member sees
on any Studio surface (the inspector, the screener surface, the Pine section of the
reference), an AI answer card, a share preview and any card that shows a script.

Three other member-facing terms, and no more:

| term | meaning | where |
|---|---|---|
| Withheld | The engine did not draw a value because it cannot compute it the way TradingView does | status items, screener columns |
| Adapted copy | A rewrite by the assistant of a script the engine does not run. Not the original | the copy's name, a badge that cannot be removed, share cards |
| UCT data | A value from our own data, not TradingView's | on the chart beside the value |

Never "Valid", "Converted", "Verified" or "Supported". A model's own description of what it
wrote appears under the label "What the assistant says it wrote", below the headline.

## 4. Lanes

Every lane is dark behind its own flag, and names its flag, its Dockerfile ARG/ENV pair and
its ledger row in its first commit. Every lane lazy-loads: nothing Studio adds may reach the
entry chunk (`python tools/notebook_perf_budgets.py --dist app/dist` after a build).

### Building now and next

Order is by what is unblocked, not by date. "Waits on" names the one thing outside this
track that a lane needs, and "if it does not come" is what the track does instead, so no
lane stalls silently on another owner (decision D15).

| # | lane | state 2026-11-15 | scope | proof | waits on / if it does not come |
|---|---|---|---|---|---|
| 1 | **S1 Pine reference** | code written, one WIP commit, never run | `scriptVerdict` (the status panel's answer as plain data) and a reference MEASURED through it: language-feature probes plus every built-in call name, each answered under named profiles (every member; runtime pane permitted), built with the build flags the ledger records as armed | the two profiles differ on at least one answer (proves the permission reached the door); the reference states the engine version it was built at, and the page shows that number beside the current one. Rebuilt in every Studio PR that touches it and once a week otherwise. v6's "age <= 1 engine version" is withdrawn: an opt-in check (D10) cannot hold a bar the engine passes three times a day | nothing. R1 and R6 would simplify it; neither blocks |
| 2 | **U4 reference placeholders** | fix committed locally, tests never run | `/formulas/reference` prints "{0}" to members; each placeholder takes the argument name from its signature | 0 placeholders left on the rendered page | the page owner's review of the PR |
| 3 | **S-L Starter library** | not started; 20 descriptions written | section 9a. Also the best available test of the door's quality: built indicators are judged by the owner's eye on a chart, not by this session reading a patch | count built in one turn / needed refinement / could not be built; each published one approved by the owner | the owner's approvals. Unapproved ones are still a ranked gap list |
| 4 | **S6 Screener surface, first cut** | not started; needs no request | One CONDITION plot of one script over one list at one timeframe, on the screen lane as it exists. On one screen: script, list, timeframe, bar-close time and data freshness, a threshold builder for a numeric plot, editable inputs, progress and cancel, symbols skipped with a reason, withheld shown as Withheld, row click to chart, save as scan or alert, a per-run verdict line. Per-run symbol cap and a per-member daily run counter. FIRST STEP, before any design: read the existing screener page and scan doors in code (D13), and measure the screen lane as it is for 500 symbols | p95 run time for 500 symbols, target set from the measured baseline. v6's "<= 5 s" was a guess with no measurement behind it and is provisional until then | nothing |
| 5 | **S1b Status panel for admins** (D3) | waits | Request R2: an admin gate beside `VITE_PINE_EDITOR_STATUS`; then the flag is set | owner looks at three scripts, one pasted on a phone | R2. If unanswered a week after the request reaches master: the owner's look happens on a local build with the flag set, which needs no engine edit, and the member decision is taken from that |
| 6 | **S9' Verdict in sharing** | waits | The Builder already ships share link, preview, install, revoke and history. Request R4: the headline, where it runs and the engine version on the share preview and install | install round-trip shows the same headline the author saw | R4. No substitute: `SharePanel` is engine-owned. It waits, and nothing else waits on it |
| 7 | **S2' Pine names on the reference page** | after S1 | `/formulas/reference` already shows every native name, generated from the engine. A Pine author's names (`ta.sma`, `request.security`, what is withheld and why) are not on it. A Pine section on that page fed by the S1 reference, stamped "built at engine N", as a pull request to the page (section 2). v6's request R10 is withdrawn: it was never filed, and the page is not engine-owned | a Pine author finds `ta.rsi` on the page; nothing added to the entry chunk | S1; then the page owner's review |
| 8 | **S3 Inspector** | waits | Values at a pinned bar (tap to pin; hover is not required), "why is this empty" rows linking to the line. Its home is decision D14 | 0 mismatches against the legend on 20 scripts on production for plotted values; and, because the legend cannot check a value that is not plotted, each intermediate value equal to the same expression plotted by a one-line probe script on 5 of the 20 | R3. No substitute: without named intermediate values there is nothing to inspect. S6 goes ahead of it |

### Closed

| lane | outcome |
|---|---|
| **S-P Prompt probe** | Done 2026-11-14. The deterministic half refuses nothing: 0 of 60 prompts stopped before the model, including all 30 that should end in "cannot". So the list v6 meant to hand over is empty, and its proof line ("0 of the 30 cannot-prompts planned as buildable") measured the wrong half: honesty lives in the model turn. The full turn was then measured: 29 refusals, 1 correct clarifying question, 0 look-alikes. The regression set is the FULL-turn 30, not the pre-model probe. Results are in `requests.md` (R9) |
| **S-R Rollout packet** | Delivered 2026-11-14 (local). It overlaps a staged-rollout proposal the authoring owner had already written (decision D16); its measurements are the part worth keeping |

### Deferred, with the condition that brings each back

| lane | why deferred | returns when |
|---|---|---|
| S6 full (every plot a column) | New server work; needs the server interpreter (W5) for runtime-lane scripts | W5 serves screens |
| S7 Settings upgrades | Polish with a shared-file cost | After launch |
| S8 UCT data in scripts | Engine-sized; the RS-rating transfer programme owns the benchmark work | CONDITION MET 2026-11-15: that programme merged as engine 57 (`docs/pine/RS-RATING-TRANSFER.md`), with a served benchmark read and a value from our own data served tagged as substituted and disclosed by name. S8 is therefore not a Studio build: what is left is showing "UCT data" beside such a value on Studio surfaces (section 3), and ledger row I6 |
| S10 Community feed | A published-formula library already exists (section 9). A separate feed would be a second one | Not planned. Threads or author names on the library are its owner's call |
| A model that writes Pine (was S4 + S5) | The existing patch-based layer already turns a description into an indicator, with a stronger guarantee. A Pine-writing model is only needed for adapted copies and for Pine-fluent authors who want editable Pine | Section 7's conditions hold, or Pine authors ask for it |
| S11 Adapted copies | See section 7 | Every condition in section 7 holds |

## 4a. What TradingView's Pine Screener does (their help article, read 2026-11-14)

Source: TradingView's help article "Pine Screener: key features and requirements", read
through a page summariser; treat each line as a pointer to check, not a quotation. Where
their documents were silent, it says so.

- **A scan:** one source (a watchlist or a major index), one indicator, one timeframe, then
  filters, then Scan. On demand: values load only after a scan, and any change needs a rescan.
- **Outputs that become columns:** `plot`, `plotbar`, `plotcandle`, `plotchar`, `plotshape`,
  `plotarrow`, `hline`, and `alertcondition`. The first ten plots become columns and filters,
  and two alert conditions are added. An indicator with none of these cannot be chosen.
- **Filters:** a condition plus a target value on a plot. The operator list is not documented.
- **Inputs:** editable in a settings dialog, except `input.timeframe`, `input.symbol` and
  `input.time`, which use the script's defaults.
- **Limits:** the last 500 bars only; fixed timeframes (1, 5, 15, 30 minutes; 1, 2, 4 hours;
  day, week, month); an index source capped at 4,000 symbols; indicators only (no
  strategies); `request.*` allowed up to 40 calls a script.
- **Not documented:** what is shown when a script errors or returns `na`; saving a screen;
  export; alerts from results; the plan tier.

**What this means for S6.** Their screener shows every plot as a column; ours accepts one
condition plot. That gap is the deferred "S6 full" lane and waits for the server
interpreter. The first cut can already beat them on two things their documents do not
offer: a per-symbol reason when a value is withheld, and saving the run as a scan or alert.

## 5. If a Pine-writing model is ever built: the rules it must follow

Deferred (section 4). Kept because the security and cost review applies to any model door,
and the existing `/converse` door should be checked against the same list (request R7).

- **Target language:** Pine, restricted to what the S1 reference shows running. One runtime.
- **Instructions:** the generated reference first, byte-stable, as a cached prefix; then
  hand-written pitfalls and worked examples. No secrets, no competitor phrasing; assume the
  document is public. Repair turns are append-only so the cache holds.
- **The model has no tools and no member data in its context.** Pasted source goes in a
  delimited block and is treated as data. Its output is Pine text only; its explanation is
  rendered as plain text. A model refusal is one of the named failure states.
- **The check is the engine**, through `scriptVerdict`, and the card states which profile was
  scored.
- **The server owns the loop:** a round counter per job (max 3), every round charged, cancel
  or reopen never resets it. What the browser reports back is a closed refusal family id plus
  a line number validated against the engine's refusal table, never free text. Prompt and
  pasted-source sizes are capped server-side (the support door's 128 KB is the precedent).
- **Metering, reusing what exists:** `daily_counters` with a dollar-equivalent charge.
  Reserve the worst case before the call and give back the difference. Take a global charge
  with the member charge. One in-flight job per member, held durably. No SDK retries.
  Register the door in the AI doors census; the usage ledger hooks itself. In-process rate
  limits are not relied on.
- **Honest ends:** runs fully / runs with N withheld / cannot yet (with the reason) / budget
  used ("You have used today's AI allowance. Resets <time>. The Code view still works.").
- **Never auto-saved, never auto-applied.**
- **Cost:** estimate it from the usage ledger before arming. Budgets, caps and cost figures
  are environment values or local notes, not committed.

## 6. Requests to the engine team (rows in `requests.md`)

State 2026-11-15: R1 to R9 were written on 2026-11-14 on the branch of this plan's pull
request, which had not merged. Master's `requests.md` held none of them, so no owner had
been asked anything and no answer was owed. Merging that pull request is the first action
in section 12. There is no R5 (the number was skipped; the entry's title says "six" and
holds five). R10 is withdrawn (lane S2').

| id | request | for |
|---|---|---|
| R1 | Move `paneFor` into `editorStatus.js` and `inspectPine` into a plain `.js` (re-exported), so the verdict can be read without React or CSS modules. Note `memberPaneDefinition.js` imports `BuilderSheet.jsx`, which still blocks plain Node | S1 |
| R2 | An admin gate beside `VITE_PINE_EDITOR_STATUS` in `editorStatusGate.js` | S1b |
| R3 | Read-only named intermediate values for a bar | S3 |
| R4 | The headline, consumers and engine version on SharePanel's preview and install | S9' |
| R6 | Export the authoritative Pine name map | S1 (removes the argument-ladder search) |
| R7 | (to the authoring owner) Check `/converse` against section 5: the budget cannot fail open, one in-flight turn per member, a global charge, sizes capped server-side, no member data in the model's context | Rollout safety |
| R8 | (to the authoring owner) From the competitor review, in order of value: a "Paste a script" mode in the same dock that hands the text to the Pine door and shows the status panel; a short version list beside Undo; a "Report a mismatch" button on each turn wired to the existing support report; the read-back shown before the model's words on every card | Create Indicator dock |
| R9 | (to the authoring owner) The S-P refused-phrase list | Create Indicator coverage |
| R10 | WITHDRAWN in v7: a pull request to the page instead (section 2) | S2' |
| R11 | (to the owner of the chart's menus) One "Indicators" entry on the chart toolbar and in the command palette that lists every indicator door that exists, in member words (section 13, E1 and E2) | Experience |
| R12 | (to the authoring owner) Four more shape-only signals on the existing telemetry: preview undone, preview discarded, number of refinements before save, and still on a chart seven days after save; and a member-pressed "Send this to UCT" on a turn, which is the only path by which a request's words are kept (section 14) | Learning loop |

## 7. Adapted copies (S11): the conditions

An adapted copy turns an honest refusal into a running script that differs from the
original. That is the failure this track exists to avoid, so it ships only if ALL hold:

1. A Pine-writing model exists and meets a measured bar on a hidden holdout: at least 65%
   "Runs fully" within 3 rounds with every required feature kept, at least 95% honest
   refusals on requests that cannot be met, at least 90% numeric agreement on a subset
   with independently computed values. These three numbers are provisional: nothing has
   been measured that they could be derived from, and they are re-set from the first
   measured run before they gate anything.
2. No output is dropped: every output of the original is re-expressed, or the copy is refused.
3. Before install the member sees, line by line, what changed, beside each original refusal.
4. The name is forced to start "Adapted: ", the badge cannot be removed, shared copies carry
   it, and the card says "Rewritten by AI. Not the same as the TradingView original."
5. The original refusal is still counted in the census and in demand ranking.
6. Never for strategies.
7. Offered only for "Not yet" and chart-refused states. A script that runs with values
   withheld leads with "Add to chart with N values withheld".
8. When the engine later runs the original, the upgrade notice offers "Your original now
   runs. Switch?"

## 8. Decisions (ruled 2026-11-14 under the owner's delegation; v2 changes marked)

| id | ruling |
|---|---|
| D1 | Adapted copies: yes in principle, built last, shipped only under section 7. **(v2: was an unconditional yes)** |
| D2 | No new model door is built by this track (v3). The existing authoring door keeps its own model and metering; request R7 checks it against section 5 |
| D3 | Status panel for admins first, by request R2; members after the owner's look |
| D4 | Sharing is members-only. No public links in v1 |
| D5 | Hide-source stays as the Builder ships it; its warning must say the script still reaches the browser, so it is hidden in the app, not secret. A licence line is required on publish and a TradingView port keeps its licence |
| D6 | The Studio session speaks for this track |
| D7 | No competitor material in this repo |
| D8 | Pine is the only authoring language; one runtime |
| D9 | Nothing is saved or applied without a press. Synced shares default to snapshot, and a synced update is never applied silently: the installer sees that the author changed it and gets a fresh verdict **(v2)** |
| D10 | The reference check is opt-in and never fails an engine change **(v2)** |
| D11 | Member text and script-drawn text render as plain text everywhere; shares and feed rows join the account-deletion manifest; an admin takedown and a per-author publish cap exist before S10 **(v2)** |
| D12 | Plain-English authoring is the EXISTING patch-based layer. This track improves and helps roll out that layer; it does not build a second one **(v3)** |
| D13 | Census before design: no lane is designed until the section 9 row for it has been read in code, and a new lane adds its row first **(v4)**. A census row is a dated reading: one older than the last change to its files is read again before the lane is designed **(v7)** |
| D14 | There is no "Studio panel" for authoring; v3 withdrew it and v6 still named one. The two surfaces this track builds have these homes: the inspector (S3) is a Studio-owned, lazy-loaded panel docked to the chart, mounted by one additive line; the screener surface (S6) is a route. Both are confirmed against the code before design (D13) **(v7)** |
| D15 | A request is made when its row is on master, not when it is written. Every lane that waits on another owner names what it does if the answer does not come (section 4). A lane with no substitute waits, and nothing else is ordered behind it **(v7)** |
| D16 | The rollout of Create Indicator ALREADY has a plan, and it is not this track's: `docs/indicators/CONVERSE-ROLLOUT-PROPOSAL-2026-11-02.md` (stages 0 to 2, QA gates G1 to G4, monitoring M1 to M5) and `CONVERSE-STAGE1-COHORT-PROPOSAL-2026-11-02.md` (the owner's 2026-11-02 decision: an opt-in pilot of 5 to 10 members, each stage approved separately). v7 wrote a gate of its own without reading them; that was a second authority over one decision and is withdrawn. What this track contributes is evidence offered to that proposal's owner: (a) the remaining 23 ordinary requests and the cost of a turn that BUILDS; (b) the hidden 40, run by a separate session; (c) the answer to request R7; (d) the owner's own look at three built indicators, one from the starter library. The dock has no phone layout (ledger U3), which the pilot should be told **(v7, corrected v8)** |
| D17 | Every Studio surface is built in the house style, `docs/uct-signature-style.md`, and to the eight commitments in section 13. A surface ships after the owner has looked at it rendered, at three widths. A reviewer model's pass is not that look **(v8)** |
| D18 | The ecosystem improves through the loop in section 14: measured, weekly, with every change shipped as a reviewed pull request. Nothing rewrites its own prompt, vocabulary or engine in production. What a member typed is never stored unless that member presses a button that says it will be sent **(v8)** |

## 9. Census: what already exists (read in code on 2026-11-14)

Two versions of this plan designed lanes for things the app already has. Every lane now
starts from this table, and a lane is not designed until its row has been read in code.

| what the competitor review looked at | what exists here | state | this track's part |
|---|---|---|---|
| Describe an indicator, get it on the chart | Create Indicator dock, `/converse`, `/propose`; UCT Agent uses the same layer (section 1a) | built, DARK (admin + per-browser switch; cohort flag pending since 2026-10-07) | rollout packet (S-R), prompt probe (S-P), requests R7 to R9 |
| A reference of what can be written | `/formulas/reference`, a nav entry, generated from the engine by `vocabulary.js` | LIVE for native formula names; no Pine names | S1 measures the Pine half; request R10 puts it on that page |
| Paste a TradingView script | The Builder's Pine tab (`PineBox`), with per-line refusals | LIVE | none |
| A trustworthy verdict on a script | The status panel (`PineEditorStatus`) | built, DARK (`VITE_PINE_EDITOR_STATUS`) | S1b: admins first (R2) |
| Share by link, preview, install, revoke | `SharePanel`, `/formulas/shared/:token`; `J2_SHARE_LINKS_ENABLED` armed | LIVE | R4: show the verdict there |
| A community library of indicators | `/formulas/library`: formulas members chose to publish, installed through the same doors; no author shown, by decision | LIVE | none now. Discussion threads and author names are decisions for the library's owner, not a new feed |
| Save a set of indicators as a template | Indicator templates (`VITE_INDICATOR_TEMPLATES_ENABLED` armed), also driven by UCT Agent | LIVE | none |
| Version history | Share history in `SharePanel`; authoring Undo in the dock | partial | R8 asks for a short version list in the dock |
| A value inspector | Not found (a chart legend exists; no per-bar named intermediate values) | MISSING | S3, after R3 |
| Run one script across a list | Screens take one condition plot; no single "this script over that list" surface | partial | S6 first cut |
| A plan to roll the authoring door out | `docs/indicators/CONVERSE-ROLLOUT-PROPOSAL-2026-11-02.md`, `CONVERSE-STAGE1-COHORT-PROPOSAL-2026-11-02.md`, `CONVERSE-ADMIN-VALIDATION-STAGE-2026-11-02.md` | written; nothing enabled; each stage needs the owner's approval | evidence only (D16). MISSED by v1 to v7 |
| A way to grade the authoring door end to end | `docs/indicators/E2E-EVAL-DESIGN-2026-11-02.md` (7 steps from request to reload, graded by tree hash, then by values); `tests/fixtures/authoring/converse_eval_cases.json` | designed; no paid run made, none without owner approval | section 14 builds on it, not beside it |
| A record of what happens on each authoring turn | `converse_turn` rows in `api/services/indicator_telemetry.py` (outcome, failure class, repair, calls, cost, tokens, latency; NO member text, enforced by an allow-list); `rollout_report(days)` | LIVE for admins' turns | section 14 reads it |
| A house style | `docs/uct-signature-style.md` (named by the owner 2026-11-15; menus, settings, widgets) | LIVE on `/charts` Release 1 | section 13 binds to it |
| Scripts on a server | `pine-runtime` service designed; `PINE_RUNTIME_SERVER_STAGE` dark | the programme's (W5) | none |

Also reused, not rebuilt: the support report ("Doesn't match TradingView?") as "Report a
mismatch"; the Builder's `ConciergeBox` and `ConverseBox`.

**What this census says about the track.** Most of what the reviewed competitor ships
already exists here, and the two strongest pieces (conversational authoring, the status
panel) are built and dark. The track's value is therefore mostly: get the dark things
safely in front of members, add the Pine half of the reference, show the verdict wherever a
script travels, and build the two things that are genuinely missing (an inspector, a
script-over-a-list surface).

## 9a. Ecosystem ledger: what was measured, what is wrong, who fixes it

The census says what exists. This ledger says how well it works, from measurements on
production as the synthetic smoke account on 2026-11-14. A row is only here if it was
measured or read in code; each says which. Rows for other owners are requests, not edits.
The row ids (I, U, N) are local to this document. The Pine programme also numbers its work
units U1, U3, U5 and so on: outside this file write "Studio ledger U4", never a bare "U4".

What the measurements do NOT yet support, stated once so no row is read for more than it
shows: the door's quality on ordinary requests rests on 7 builds, each judged by the same
session that wrote the prompt, by reading the patch. Two of those 7 were wrong in a way a
trader would see at once (I3, I4). Nothing here is evidence the owner would accept a built
indicator on a chart; lane S-L and decision D16(d) are where that is found out.

### Intelligence (does it understand and answer well)

| # | finding | evidence | fix | owner |
|---|---|---|---|---|
| I1 | Create Indicator refuses plainly impossible requests honestly | 30 prompts through the full turn: 29 `unsupported`, 1 `clarify`, 0 built (measured) | none; keep as a regression set | authoring |
| I2 | It builds ordinary trader requests in one call | first 7 of 30 member-style prompts: 7 built, each patch matching the request on reading (three EMAs with a rising/falling colour, ADR %, volume-spike marker, background above a rising 50, 52-week high from weekly bars, distance from the 50 in ATRs, inside-bar paint). The other 23 are queued behind the hourly limit. Patches were read, not applied | finish the 30; then run the hidden 40 | this track measures; authoring fixes |
| I3 | Colour words are not honoured literally: "green" came back teal (`#26A69A`) twice, and the read-back says "teal" | measured, dock and API | map the member's colour word to that colour, or say "green" when the house green is used | authoring (R8) |
| I4 | "Average daily range percent" was built as range over close; the common definition averages high over low | measured (M02) | a named house definition for ADR %, so the term means one thing here | authoring |
| I5 | The planner attaches unrelated terms on some sentences ("email ... at the close" -> `close`) | measured, 60 prompts | exclude a term when its word is not used as a series in the clause | authoring (R9) |
| I6 | Columns the app already has (institutional ownership, analyst targets) are refused at the chart door as "not available from price and volume" while the planner matches them | measured (X02, X13) | decide whether declared columns are reachable from an indicator as a current value, labelled "UCT data". A precedent now exists: engine 57 serves a value from our own data, tagged and disclosed, where TradingView's is not available. The open part is whether that extends from classification text to fundamentals columns | owner decision, then authoring + engine |
| I7 | No measure yet of subtle impossible requests, or of whether a built indicator's VALUES are right | not measured | the hidden 40; a numeric subset checked against independently computed values | this track |

### Surface (can a member find it and read it)

| # | finding | evidence | fix | owner |
|---|---|---|---|---|
| U1 | Create Indicator works and is dark | dock opened, preview drawn in about 14 s, Undo / Discard / Add to Chart (measured) | the rollout decision (lane S-R) | owner |
| U2 | Its door is three levels down: the chart's gear -> Indicators -> Create Indicator | measured | a direct entry beside the chart toolbar and in the command palette | authoring (R8) |
| U3 | The dock has no phone layout | read in code: `CreateIndicatorPanel` is a fixed 360 px panel with no breakpoint rule and no sheet; a scripted attempt at 390 px did not reach it | a full-screen sheet on the touch tier (<= 1024 px), as the status panel's spec already does | authoring (R8) |
| U4 | `/formulas/reference` shows template placeholders to members: "the absolute value of {0}" (85 of 86 functions, every operator) | read in code and seen on the page | FIX WRITTEN: branch `fix/formula-reference-placeholders`, each placeholder takes the argument name from the signature above it; its tests are queued, not yet run | this track, for the page owner's review |
| U5 | `/formulas/reference` has no Pine names | read in code | the S1 reference, as a Pine section | this track + R10 |
| U6 | `/formulas/library` is empty | seen: "Nothing has been published yet" | lane S-L below | this track + owner |
| U7 | A first-run coach card overlays the reference and library pages for a new account | seen | dismiss on route change, or anchor it | its owner |
| U8 | The status panel is dark | ledger | lane S1b | engine (R2) |
| U9 | No per-bar value inspector; one condition plot per screen | census | S3, S6 | this track after R3 |

### Infrastructure (can the work be done and trusted)

| # | finding | evidence | fix | owner |
|---|---|---|---|---|
| N1 | One heavy job at a time: this track's first test run waited over 70 minutes behind one engine job and had not started. As of 2026-11-15 no test of this track's code has ever run | measured | engine-free unit tests by design (done for S1); ask the coordinator whether Studio's engine-free files may run outside the lock; run the opt-in reference build in off-hours | coordinator |
| N2 | The authoring door's shared hourly window is 40 turns; a member exploring can hit it in one sitting, and a measuring run does | measured (HTTP 429 on turn 41) | a member-facing message with the reset time; a higher window for the cohort if cost allows (about $0.02 to $0.03 a turn measured) | authoring / owner |
| N3 | The member daily cap falls back to a default that was sized for a far higher per-turn cost than measured | read in code + measured cost | set `CONVERSE_USER_CAP_DAILY` from measured cost | owner |
| N4 | The reference would have been measured under flags no member has | found in review | profiles from the flag ledger (done in S1) | this track |
| N5 | A sparse worktree keeps a lane near 200 to 400 MB | measured | use it for every Studio lane | this track |

### New lane from the ledger

**S-L Starter library, authored through the existing door.** The library is empty, and the
competitor review shows what traders build first (follow-through and distribution-day
counters, base recognition with zones, RS new highs, ATR extension and stops, anchored
VWAPs, earnings tables, position sizing). Describe each of about 20 in plain words to Create
Indicator, as an admin, and record for each: built in one turn / needed refinement / could
not be built, and why. Indicators the owner approves are published to the library as house
formulas. This does three things at once: it is a demand-shaped test of the authoring door,
it fills the library before launch, and every "could not be built" is a ranked gap for the
authoring and engine teams. Proof: the count in each bucket. Nothing is published without
the owner's approval of each one.

## 10. What this track will not do

- Edit engine-owned files, bump the engine version, or draw anything the engine refused.
- Add a second scripting language or runtime.
- Save or apply anything without a press.
- Show a model's description of its own output as a verdict.
- Copy a competitor's documents, formulas or members' scripts.

## 11. What each review changed (newest first; unmarked rows are v1 -> v2)

Some v2 rows describe changes that v3 later withdrew (the chart-docked Studio panel,
generation with repair). They are kept as history; sections 1a and 4 are what holds.

| finding | change |
|---|---|
| **v8:** the plan committed to no standard for how any of this looks or is reached; the only design statements were three defects handed to another owner | Section 13, D17, request R11, lane S-X |
| **v8:** the plan measured the ecosystem once and had no way for it to improve; "the hidden 40" was a one-time test | Section 14, D18, request R12, lane S-M |
| **v8:** a third census miss. The authoring owner's staged-rollout proposal, its end-to-end evaluation design and its per-turn telemetry all existed; v7's D16 duplicated the first | D16 corrected; four census rows added |
| **v7:** the requests to the engine and authoring owners were only on an unmerged branch; four lanes waited on answers nobody had been asked for | Section 6 note, D15, first action in section 12 |
| **v7:** four of six "building now" lanes depended on another owner, with no date and no substitute | "Waits on / if it does not come" column; S6 moved ahead of S3; S2' became a pull request and R10 was withdrawn |
| **v7:** S-P and S-R were finished but still listed as work, and S-P's proof measured the half of the door that refuses nothing | A state column and a Closed table; the regression set is the full-turn 30 |
| **v7:** "reference age <= 1 engine version" cannot be held by an opt-in check while the engine moves three versions a day | S1's proof is the built-at number shown beside the current one, and a rebuild rule |
| **v7:** three acceptance numbers had no measurement behind them (S6's 5 s, section 7's 65 / 95 / 90) | Marked provisional; S6 measures the existing lane first |
| **v7:** the inspector's proof compared against the legend, which cannot see the intermediate values the inspector exists to show | A probe-script check for intermediates |
| **v7:** v6 still named a "Studio panel" that v3 had withdrawn, and gave the inspector and the screener surface no home | D14; sections 2 and 3 |
| **v7:** the rollout of Create Indicator was an open question with no condition that would close it | D16 |
| **v7:** S8's return condition was met the day after it was written; the plan's facts had aged (engine 54, the S1 branch described as uncommitted, the worktree's size and folders) | S8 row, ledger I6, sections 2 and 12; D13 now says a census row is a dated reading |
| **v7:** the ledger's row ids collide with the Pine programme's unit names; the evidence for build quality was thinner than the ledger read | Notes at the head of section 9a |
| The reference would have been measured with every Pine build flag unset and no runtime permission: a configuration no member has | Named profiles, flags read from the ledger, a control that the two profiles differ |
| A probe could "run" while the probed plot itself was withheld | "Ran" now needs a plot drawn and nothing withheld |
| `builder/**` was unowned in v1, and the reference check would have failed engine changes | Named engine-owned; the check is opt-in |
| The Builder is a 640 px modal; "chart beside it" there was not a one-line edit | Studio is its own chart-docked panel |
| Sharing was planned as new work; it already ships | S9 became a request to show the verdict there |
| "Plots become columns" was described as existing; screens take one condition plot | S6 first cut is one condition plot; the rest waits for W5 |
| Lane order delivered nothing a member feels for weeks | Status panel and code view first; generation only with repair |
| No measure of whether generated scripts are right, only whether the engine accepts them | Golden set with a hashed holdout, required-feature checklists and a numeric subset |
| The budget could fail open; the repair loop could be amplified; synced shares are an update channel | Section 5 and D9 |
| Adapted copies risked the failure this track criticises | Section 7 |
| A second vocabulary was forming | Section 3 |
| **v5:** the plan said what exists but not how well it works | Section 9a: 30 impossible and 7 ordinary requests run through the existing authoring door on production, a tour of the reference and library pages, and the defects and fixes that came out of it; lane S-L (a starter library authored through the existing door) |
| **v4:** a second look found a live formula reference page, a live published-formula library, live share links and live indicator templates. v3 still planned a new reference tab and listed a community feed as deferred work | Section 9 census; decision D13; the reference lane became a request to add Pine names to the existing page; the feed is no longer planned |
| **v3:** v1 and v2 planned a new authoring dock and a Pine-writing model. A conversational Create Indicator dock already exists, dark, built on validated patches over the engine. The Studio session found it while preparing the dock lane; the plan and all four reviews had missed it because they were pointed at the Pine documents, not `docs/indicators/` | The dock lane and the generation lane are withdrawn; section 1a; lanes S-P and S-R; requests R7 to R9 |

## 12. Resume here (state at 2026-11-15)

This plan is FINAL as a plan. What follows is where the work stands, so a later session can
pick it up without the conversation.

**Decided, nothing pending from the owner to start:** sections 2, 3, 8 and 9.

**Owner decisions still open (none blocks the lanes in section 4):**
1. Create Indicator: the owner's own look at three built indicators; then the stages of
   the existing rollout proposal, each approved separately (decision D16; ledger U1, N3).
2. May an indicator read fundamentals columns the app already has, as a current value
   labelled "UCT data" (ledger I6)?
3. Approve, one by one, any starter-library indicator before it is published (lane S-L).

**Branches (all in the sparse worktree `uct-worktrees/studio-s1`):**

| branch | holds | state 2026-11-15 |
|---|---|---|
| `docs/studio-track-plan` | this plan, the `requests.md` entries | pushed; a docs-only pull request, checks green, merges clean. NOT MERGED |
| `fix/formula-reference-placeholders` | the reference page fix (ledger U4) | one local commit, NOT pushed, several hundred commits behind master; tests never run |
| `feat/studio-s1-reference` | lane S1: `app/src/components/studio/` (`verdict/`, `reference/`) | one local WIP commit, untested, NOT pushed. It was cut before v4 and carries an old copy of this plan and of `requests.md`: rebase it onto master after the plan merges and drop both files from it. The worktree also holds an untracked copy of the same six files (byte-identical to the commit when checked); remove it before checking the branch out |

The heavy lock was free when this was written, so action 2 can start at once.

**Next actions, in order:**
1. Merge the plan's pull request. Until then the requests in section 6 are on no one's list.
2. Rebase the two code branches onto master. Run their engine-free test files through the
   lock (`referenceSentence.test.js`, `formulaReference.route.test.jsx`,
   `buildPineReference.test.js`). Push the reference fix and open its pull request.
3. S1: fix what its run shows; build the reference at the current engine
   (`STUDIO_MEASURE=1 STUDIO_WRITE_REFERENCE=1`); READ THE DIFF; replace the WIP commit; open
   its pull request.
4. Finish the 30 member-style prompts through the authoring door (23 remain; the door allows
   40 turns an hour per account), record what a BUILDING turn costs, and append the result
   to `requests.md` (D16a).
5. Lane S-L: the 20 starter-library descriptions through Create Indicator, with the owner
   looking at the results on a chart (D16d).
6. The hidden 40, run by a session that does not edit this plan's reference or any
   assistant prompt (D16b).
7. Lane S-X (section 13): the walk-through and the three mock-ups for the owner to pick
   from. It comes BEFORE any new surface is designed, so S6 and S3 are built to it.
8. Lane S-M (section 14): the first weekly scoreboard, from what is already recorded.
9. S6 first cut: census and baseline measurement first. Then S2' on the back of S1. S1b,
   S9' and S3 start as R2, R4 and R3 are answered, with the substitutes in section 4.

**Kept outside this repo (local only):** the competitor review, the rollout packet for
Create Indicator, the prompt sets and their results, and screenshots.

## 13. The experience: what a member sees and how they reach it

Sections 1 to 12 say what exists and what gets built. This section is the commitment about
how it feels to use, because a capable system that a member cannot find or read is the same
to them as one that does not exist. Today's state, measured: the strongest feature is three
menus deep, has no phone layout, the library is empty and the reference printed "{0}".

**The style** is `docs/uct-signature-style.md`, unchanged and with no new tokens: quiet
graphite panels, sentence-case plain words, gold only on what is current or chosen,
controls shown when needed, one way to do each thing.

**Eight commitments. Each has a check that can fail.**

| # | commitment | check |
|---|---|---|
| E1 | **Two actions from the chart.** Every indicator capability (describe one, paste a script, browse the library, look something up, run a script over a list, inspect a bar) is reachable in at most two actions from the chart, and by typing its name in the command palette | count the actions, per capability, on production |
| E2 | **One map.** A single "Indicators" entry lists every door that exists, in member words ("Describe an indicator", "Paste a TradingView script", "Browse indicators", "Look up a function", "Run a script over a list"). It is a menu of the existing doors, not a new door (D12 holds) | every capability in E1 appears in it; nothing in it is a dead link |
| E3 | **A first indicator in a minute.** A member who has never used it goes from a chart to a previewed indicator in under 60 seconds without reading anything. The 60 is provisional until the first timed run | timed with the owner first, then with the pilot members; the median is reported |
| E4 | **Works on a phone.** At 1024 px and below every Studio surface is a full-screen sheet, never a fixed-width panel | rendered and used at 390, 820 and 1200 px; elements named, not counted |
| E5 | **No dead ends.** Every state is designed: loading, empty, withheld, cannot, allowance used, offline. Each one says what happened in one plain sentence and offers one next action. An empty library offers the starter set; a refusal offers the nearest thing that can be built | a table of states per surface, each with its sentence and its action, reviewed before build |
| E6 | **One vocabulary** (section 3), and the engine's words above the assistant's on every card | a sweep of rendered text for the banned words |
| E7 | **It never surprises.** Nothing is saved, applied, shared or charged without a press (D9); every preview has Undo; how much of the daily allowance is left is visible before it runs out, with the reset time | each destructive or paid action traced to a press |
| E8 | **The owner's eye is the bar** (D17). Each surface is shown rendered, at three widths, on real charts, before it ships | the owner's yes, recorded with the date |

**Lane S-X, the experience pass (before S6 or S3 is designed).**
1. Census, as D13 requires: walk every indicator door on production as the smoke account at
   three widths, after the 2026-11-15 chart-menu release. Record the actions to reach each,
   and every state in E5 that is missing.
2. Three mock-ups of the "Indicators" map and of one Studio surface (the screener surface),
   as rendered pages, for the owner to pick one and vary it.
3. The picked direction becomes a one-page addendum beside the style guide, and requests
   R11 and R8 are updated to match it.

Proof: the E1 action counts before and after, and the owner's pick. Stop at the addendum.

## 14. The learning loop: how it gets better every week

What "learning" means here, stated plainly so it is not over-read. The assistant's model is
not retrained by us and nothing in production rewrites itself. The ecosystem gets better
because every use leaves a signal, the signals are ranked each week, each top item is fixed
in the layer where it belongs, and each fix is proved against a growing set of cases before
it ships. That loop can run every week without limit. It rests on the one thing this
design has that a model-trusting design does not: an engine that computes the answer, so
there is something to measure against.

**What already exists to build on (census, section 9):** a per-turn record with outcome,
failure class, cost and latency and no member text; an aggregate report including
unsupported demand; an end-to-end evaluation design that grades by values, not by the
model's word; the engine census and its demand ranking; the support report.

**The loop, five steps:**

| step | what happens | exists / to add |
|---|---|---|
| 1. Capture | Every turn records its shape. Four signals of whether the result was actually wanted: preview undone, preview discarded, refinements before save, still on a chart seven days later. A member may press "Send this to UCT" on any turn, which is the only way a request's words are kept | the record exists; the four signals and the button are request R12 |
| 2. Rank | Weekly, one page: what members asked for that could not be built (by class), what was built and then thrown away, what needed several tries, what was refused, cost and time per turn | `rollout_report` exists; the page is lane S-M |
| 3. Route | Each top row goes to exactly one layer: a house definition (one meaning for "ADR %"), the assistant's instructions or examples, an engine capability (a row in `requests.md`, counted in the engine's demand ranking), or the surface (section 13) | owners per section 2 |
| 4. Prove | Every fixed case joins the evaluation set, so the set grows with use. Before any change to the assistant's instructions, its model or its vocabulary, the set is run and compared with the last run. Values are checked against independently computed numbers, not read by eye. A hidden set, written and run by a session that does not edit the assistant, is replaced every quarter so it cannot be learned | the evaluation design exists; the runs are paid and need the owner's approval of the spend |
| 5. Publish | A scoreboard, one line a week: built in one turn, honest refusals, value agreement, kept after seven days, median cost, time to preview. Stamped with the engine version and the assistant's instruction version, so a drop is traceable to the change that caused it | lane S-M |

**What the system accumulates, beyond scores.** Owner-approved starter-library indicators
become worked examples the assistant can be shown (how is the authoring owner's call). House
definitions accumulate so a term means one thing. The Pine reference is rebuilt from each
engine version, so what the assistant and the member are told is possible is never far
behind the engine.

**Rules of the loop (D18).** No member text without the member's press. No change without a
before and after on the set. A regression on the hidden set blocks the change. Numbers that
gate anything are derived from a measured run, never chosen in advance.

**Lane S-M, the measuring half (this track owns it; the fixes belong to their owners).**
The weekly page and the scoreboard, generated from what is recorded, kept local while the
numbers include cost. First issue from the admin turns already recorded. Proof: the page
exists for two consecutive weeks and at least one row from it was routed and closed. Stop
rule: none; this is the lane that does not end.
