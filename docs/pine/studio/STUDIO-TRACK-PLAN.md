# Studio track: the plan, beside the Pine full-parity programme

FINAL v5, 2026-11-14. v1 was reviewed the same day by four independent reviewers (engine
fit, security and cost, product and member experience, adversarial delivery); v2 carried
their findings. v3 corrects a miss that neither v1, v2 nor any reviewer caught: plain-English
indicator authoring ALREADY EXISTS in this repo (section 1a). Section 11 lists every change
and why. v4 adds the census in section 9: a second look found the formula reference page,
the published-formula library, share links and indicator templates already live, so the rule
from here on is CENSUS BEFORE DESIGN (decision D13). The owner delegated every open decision;
the rulings are in section 8. v5 adds section 9a, a ledger of what was MEASURED on
production (how well the existing pieces work, what is wrong, who fixes it) and lane S-L.

This repo is public. Only this plan and generated engine references are committed. The
competitor review that informed it, and the competitor's own documents, stay local.

Read with:
- `_resume-2026-11-01/PINE-FULL-PARITY-PLAN.md` and `AGENT-RULES.md` (the programme and its
  rules, which every lane here inherits unchanged)
- `docs/pine/SESSION-STATE.md` (engine state; re-read `scriptEngineVersion.js` on master for
  the current number, it was 54 when this was written)
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
week:** the mount point of the Studio panel, `Dockerfile.web` + `docs/feature_flags.json`
(flags), `persistenceManifest.json` (storage keys), the palette entry.

**Asking the engine for something:** a row in `requests.md` at the repo root, picked up by
the Pine coordinator. Never a direct edit to an engine-owned file, never an engine version
bump. Open requests are listed in section 6.

**Reading the engine:** only through existing exports. Studio derives, never restates.

**Studio's reference never fails an engine change.** The check that the committed reference
is current is opt-in (`STUDIO_MEASURE=1`) and run by the Studio session. The reference
carries the engine version it was built at and the app shows that number.

**Machine rules:** AGENT-RULES unchanged. One heavy job at a time through the lock, targeted
vitest files with a low worker count, a sparse worktree (`app`, `tools`, `docs/pine`; about
200 MB) with a junction to the shared install, branch pushes only. Fake-verdict unit tests
stay engine-free and fast so they never queue behind an engine run for long.

## 3. One vocabulary

The status panel's headline, verbatim from `editorStatus`, is the ONLY verdict a member sees
on the Studio panel, an AI answer card, a share preview and any card that shows a script.

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

### Building now and next (the two-week order)

| # | lane | scope | proof (a number) | stop rule |
|---|---|---|---|---|
| 1 | **S1 Pine reference** | `scriptVerdict` (the status panel's answer as plain data) and a reference MEASURED through it: language-feature probes plus every built-in call name, each answered under named profiles (every member; runtime pane permitted), built with the build flags the ledger records as armed | reference age <= 1 engine version; the two profiles differ on at least one answer (proves the permission reached the door) | Stop when the measured reference is committed and the check is opt-in |
| 2 | **S-P Prompt probe for the existing door** | The track's 60 open prompts (30 member-style, 30 that must end in an honest "cannot") run through the existing door's deterministic half (pre-flight, member names, planner), the method the 2026-11-01 authoring note used with 58 phrasings. Output: which phrasings are refused before the model is called, handed to the authoring owner as a request with the exact phrases | refused-before-model count on the 30 member-style prompts; 0 of the 30 cannot-prompts planned as buildable | Stop when the list is handed over |
| 3 | **S1b Status panel for admins** (D3) | Request R2: an admin gate beside `VITE_PINE_EDITOR_STATUS`; then the flag is set | owner looks at three scripts, one pasted on a phone | Stop after the three scripts |
| 4 | **S-R Rollout packet for Create Indicator** | Not a build. A go / no-go packet for the owner on `CREATE_INDICATOR_COHORT_ENABLED`: what the door does today, the S-P results, the cost per turn from the usage ledger, what a member sees, the rollback. The decision and the arming stay with the authoring owner and the owner | packet delivered | Stop at the packet |
| 5 | **S9' Verdict in sharing** | The Builder already ships share link, preview, install, revoke and history. Request R4: the headline, where it runs and the engine version on the share preview and install | install round-trip shows the same headline the author saw | Stop at the round-trip |
| 6 | **S2' Pine names on the reference page** | `/formulas/reference` already shows every native name, generated from the engine. A Pine author's names (`ta.sma`, `request.security`, what is withheld and why) are not on it. Request R10: a Pine section on that page fed by the S1 reference, stamped "built at engine N" | a Pine author finds `ta.rsi` on the page; nothing added to the entry chunk | Stop at route smoke |

### After those, in this order

| lane | scope | proof |
|---|---|---|
| **S3 Inspector** | Values at a pinned bar (tap to pin; hover is not required), "why is this empty" rows linking to the line. Needs request R3 | 0 mismatches against the legend on 20 scripts on production |
| **S6 Screener surface, first cut** | One CONDITION plot of one script over one list at one timeframe, on the screen lane as it exists. On one screen: script, list, timeframe, bar-close time and data freshness, a threshold builder for a numeric plot, editable inputs, progress and cancel, symbols skipped with a reason, withheld shown as Withheld, row click to chart, save as scan or alert, a per-run verdict line. Per-run symbol cap and a per-member daily run counter | p95 run time for 500 symbols <= 5 s |

### Deferred, with the condition that brings each back

| lane | why deferred | returns when |
|---|---|---|
| S6 full (every plot a column) | New server work; needs the server interpreter (W5) for runtime-lane scripts | W5 serves screens |
| S7 Settings upgrades | Polish with a shared-file cost | After launch |
| S8 UCT data in scripts | Engine-sized; the RS-rating transfer programme already owns the benchmark work | That programme lands a served benchmark read |
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
| R10 | (to the owner of `/formulas/reference`) A Pine section on that page, fed by the S1 reference | S2' |

## 7. Adapted copies (S11): the conditions

An adapted copy turns an honest refusal into a running script that differs from the
original. That is the failure this track exists to avoid, so it ships only if ALL hold:

1. A Pine-writing model exists and meets a measured bar on a hidden holdout: at least 65%
   "Runs fully" within 3 rounds with every required feature kept, at least 95% honest
   refusals on requests that cannot be met, at least 90% numeric agreement on a subset
   with independently computed values.
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
| D13 | Census before design: no lane is designed until the section 9 row for it has been read in code, and a new lane adds its row first **(v4)** |
| D12 | Plain-English authoring is the EXISTING patch-based layer. This track improves and helps roll out that layer; it does not build a second one **(v3)** |
| D11 | Member text and script-drawn text render as plain text everywhere; shares and feed rows join the account-deletion manifest; an admin takedown and a per-author publish cap exist before S10 **(v2)** |

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

### Intelligence (does it understand and answer well)

| # | finding | evidence | fix | owner |
|---|---|---|---|---|
| I1 | Create Indicator refuses plainly impossible requests honestly | 30 prompts through the full turn: 29 `unsupported`, 1 `clarify`, 0 built (measured) | none; keep as a regression set | authoring |
| I2 | It builds ordinary trader requests in one call | first 7 of 30 member-style prompts: 7 built, each patch matching the request on reading (three EMAs with a rising/falling colour, ADR %, volume-spike marker, background above a rising 50, 52-week high from weekly bars, distance from the 50 in ATRs, inside-bar paint). The other 23 are queued behind the hourly limit. Patches were read, not applied | finish the 30; then run the hidden 40 | this track measures; authoring fixes |
| I3 | Colour words are not honoured literally: "green" came back teal (`#26A69A`) twice, and the read-back says "teal" | measured, dock and API | map the member's colour word to that colour, or say "green" when the house green is used | authoring (R8) |
| I4 | "Average daily range percent" was built as range over close; the common definition averages high over low | measured (M02) | a named house definition for ADR %, so the term means one thing here | authoring |
| I5 | The planner attaches unrelated terms on some sentences ("email ... at the close" -> `close`) | measured, 60 prompts | exclude a term when its word is not used as a series in the clause | authoring (R9) |
| I6 | Columns the app already has (institutional ownership, analyst targets) are refused at the chart door as "not available from price and volume" while the planner matches them | measured (X02, X13) | decide whether declared columns are reachable from an indicator as a current value, labelled "UCT data" | owner decision |
| I7 | No measure yet of subtle impossible requests, or of whether a built indicator's VALUES are right | not measured | the hidden 40; a numeric subset checked against independently computed values | this track |

### Surface (can a member find it and read it)

| # | finding | evidence | fix | owner |
|---|---|---|---|---|
| U1 | Create Indicator works and is dark | dock opened, preview drawn in about 14 s, Undo / Discard / Add to Chart (measured) | the rollout decision (lane S-R) | owner |
| U2 | Its door is three levels down: the chart's gear -> Indicators -> Create Indicator | measured | a direct entry beside the chart toolbar and in the command palette | authoring (R8) |
| U3 | The door was not found at phone size | one scripted attempt; unverified | find the phone path or add one | authoring |
| U4 | `/formulas/reference` shows template placeholders to members: "the absolute value of {0}" | read in code (`FormulaReference.jsx` renders `item.sentence` as is) and seen on the page | fill the placeholders with the signature's argument names | reference owner (R10) |
| U5 | `/formulas/reference` has no Pine names | read in code | the S1 reference, as a Pine section | this track + R10 |
| U6 | `/formulas/library` is empty | seen: "Nothing has been published yet" | lane S-L below | this track + owner |
| U7 | A first-run coach card overlays the reference and library pages for a new account | seen | dismiss on route change, or anchor it | its owner |
| U8 | The status panel is dark | ledger | lane S1b | engine (R2) |
| U9 | No per-bar value inspector; one condition plot per screen | census | S3, S6 | this track after R3 |

### Infrastructure (can the work be done and trusted)

| # | finding | evidence | fix | owner |
|---|---|---|---|---|
| N1 | One heavy job at a time: this track's first test run waited over 70 minutes behind one engine job and had not started | measured | engine-free unit tests by design (done for S1); ask the coordinator whether Studio's engine-free files may run outside the lock; run the opt-in reference build in off-hours | coordinator |
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

## 11. What the review changed (v1 -> v2)

| finding | change |
|---|---|
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
