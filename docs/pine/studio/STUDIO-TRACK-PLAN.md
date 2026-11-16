# The indicator ecosystem: final blueprint (Studio track)

FINAL v9, 2026-11-15. This version is a rewrite, not a ninth layer. v1 to v8 were each
corrected by finding something that already existed; v9 was written after six independent
specialist reviews of v8 against master (a code census, a review of the competitor research
against the public record, product and interface design, model and learning systems, fit
with the engine programme, and an adversarial review of opening the features to everyone).
Their findings are folded into the text, and section 16 lists what each changed.

This repository is public. Only this plan and generated references are committed. The
competitor review that informed it stays local, and no competitor is named here.

Every claim about code in this plan is a reading of master on 2026-11-15 (engine version
57). It is a dated reading, not a fact: re-read the file before acting on it (rule P1).

## 1. What this is

A member wants to do seven things with an indicator:

| # | job | in member words |
|---|---|---|
| J1 | describe one in plain words and see it on the chart | "Describe an indicator" |
| J2 | bring one from TradingView | "Paste a TradingView script" |
| J3 | use one somebody else made | "Browse indicators" |
| J4 | find out what a function does or whether it runs here | "Look up a function" |
| J5 | run one across a list of stocks | "Run over a list" |
| J6 | see why it shows what it shows on one bar | "Inspect a bar" |
| J7 | change, undo, go back a version, share | on every indicator |

Almost every one of these is already built. The finding of all six reviews is the same:
the capability is here and stronger than the competitor's at its core (the engine computes
the answer and writes the description; a model is never trusted to describe its own work),
but it is scattered behind seven doors, six names for one thing, a dark switch and no phone
layout, and nothing yet makes it better with use.

So this track does four things, in this order:

1. **Open it.** Every finished, dark indicator feature goes to every account (section 8).
2. **Make it one place.** One home, one name, one first-run moment, a phone layout
   (section 6).
3. **Make it learn.** Version every answer, measure it, and feed fixes back through a
   weekly loop with a regression gate (section 7).
4. **Fill the real gaps.** A per-bar inspector, running an indicator over a list straight
   from the chart, Pine names in the reference, the verdict on shared indicators
   (section 9, phase 4).

## 2. Owner rulings in force

| date | ruling |
|---|---|
| 2026-11-15 | The product has not launched. Finished indicator features are opened to every account now. The staged pilot in `docs/indicators/CONVERSE-ROLLOUT-PROPOSAL-2026-11-02.md` is not followed before launch; the parts of it that are cheap now and costly later are kept as the launch-readiness list (section 8) |
| 2026-11-15 | The interface must be attractive, simple and easy to reach; the system behind it must be capable and get better with use. Sections 6 and 7 are the commitments |
| 2026-11-15 | House style for menus, settings and widgets is `docs/uct-signature-style.md` |
| 2026-11-14 | Every open design decision in this track is delegated to the Studio session; the rulings are section 11 |
| 2026-11-14 | A value from our own data where TradingView's is unavailable is served, labelled "UCT data", and never graded as matching |
| standing | Nothing a member typed is stored unless that member presses a button that says it will be sent |

## 3. Census: what exists on master

Read in code on 2026-11-15. "Owner" is whose code it is (section 4).

| job | what exists | where | state | owner |
|---|---|---|---|---|
| J1 | Create Indicator dock: conversation, live preview on the real chart, refine, Undo, save. The model emits a validated patch; the engine writes the read-back | `chart/builder/studio/`, `builder/authoring/`, `api/services/definition_conversation.py`, `POST /api/user-definitions/converse` | built; reachable by admins with a per-browser switch; members see a disabled "Describe one - Soon" pill | Indicators |
| J1 | One-formula proposals in plain words | `ConciergeBox`, `/propose` | LIVE to paid accounts | Indicators |
| J1 | The same layer through UCT Agent; where the Agent is registered the request opens the Agent, not the dock | `agent/`, `ChartToolbar.jsx` | admin | Agent |
| J1 | An indicator from a picture | `builder/ImageBox.jsx`, `indicator_from_image.py` | built | Indicators |
| J2 | Paste Pine, with per-line refusals | `builder/PineBox.jsx` (the Builder's "Import" tab) | LIVE | Pine engine |
| J2 | Bring a whole library at once | `builder/libraryIntake.js` | built | Indicators |
| J2 | The status panel: one headline verdict for the text in the editor | `builder/PineEditorStatus.jsx`, `editorStatus.js` | built; a BUILD flag, `VITE_PINE_EDITOR_STATUS`, unset | Pine engine |
| J3 | The home: the chart's Indicators window, with search, tabs and the "Describe one" and "New formula" pills | `chart/ChartSettingsIndicators.jsx` | LIVE | Indicators |
| J3 | Members' published indicators; install | `/formulas/library` | LIVE, EMPTY, and not in the desktop navigation | formulas pages |
| J3 | Share by link: preview, install, revoke, history | `SharePanel.jsx`, `/formulas/shared/:token` | LIVE; shows no verdict and no engine version | Pine engine / formulas pages |
| J3 | Indicator templates | flag armed | LIVE | Indicators |
| J4 | A reference of native function names, generated from the engine | `/formulas/reference` | LIVE; prints "{0}" placeholders; no Pine names | formulas pages |
| J4 | Every Pine built-in name, probed through the import door and regenerated whenever the door changes | `chart/supportLoop/doorNameCoverage.json`, `pineBuiltins.json` (755 names) | generated, stale-checked by its own test | support loop |
| J5 | Run a saved indicator over a list: a job with progress, up to 500 symbols, one run per member, a receipt that says what was covered, withheld and dropped; daily, weekly, monthly | `api/routers/scan_run.py`, `api/services/screener/scan_run.py`, `components/screener/RunNowButton.jsx`, `ScanResults.jsx`, `pages/screener/ScreensManager.jsx` | LIVE, five or more actions deep, only from the Screener | Screener |
| J5 | A threshold builder that turns a numeric line into a condition | `builder/toCondition.js` | built | Indicators |
| J5 | Plain-English screens | `api/routers/screener_nl.py` | armed | Screener |
| J6 | Values of every plotted line under the crosshair | `engine/readout.js`, `legend/` | LIVE | Pine engine |
| J6 | Values the script computes but does not plot | none | MISSING | - |
| J7 | Undo in the dock; "Modify with UCT Intelligence", "Edit formula", "Create custom copy" on the legend chip | `legend/chipMenu.js` | LIVE | Indicators |
| J7 | Every save is a version | `GET /api/user-definitions/{def_id}/history` | LIVE on the server; shown only inside the Builder's Share tab | Indicators |
| all | Command palette | `components/CommandPalette.jsx` | LIVE; lists no indicator command at all | app shell |
| all | A record of every authoring turn: outcome, failure class, repair, cost, tokens, latency; and dock actions opened, preview, saved, save failed, discarded, turn failed. No member text, enforced by an allow-list | `api/services/indicator_telemetry.py`, `rollout_report(days)` | LIVE | Indicators |
| all | An evaluation runner for the authoring door: a free scripted mode, a spend-capped live mode, grading by tree hash and then by values, gates | `tools/converse_eval.py`, `tests/fixtures/authoring/converse_eval_cases.json`, `docs/indicators/E2E-EVAL-DESIGN-2026-11-02.md` | BUILT; no paid run made | Indicators |
| all | A support loop for Pine imports: consented "Doesn't match TradingView?" reports with retention and withdrawal, a daily ranked digest, triage, mark-fixed, nightly re-measure | `docs/pine/support-loop/`, `api/services/indicator_support*.py`, `tools/support_loop/`, `ReportMismatchDialog.jsx` | built; reports behind `PINE_SUPPORT_REPORTS_ENABLED` | support loop |
| all | Firm concepts with cited definitions, versioned | `chart/engine/ast/conceptVocabulary.json` | LIVE | Pine engine |
| all | The single list of open Indicators work | `docs/indicators/INDICATORS-BACKLOG.md` | maintained | Indicators |

Names already taken, which this plan must not reuse for something else: "Starter library"
(`builder/StarterLibrary.jsx`, firm setups as editable scans), "inspector" (the settings
column of the Indicators window), "studio" (`builder/studio/`, the dock).

## 4. Who owns what, and how to ask

v8 split the code two ways (engine, Studio). There are six owners.

| owner | paths | how to ask |
|---|---|---|
| Pine engine | `chart/engine/**`, `builder/memberPane/**`, `editorStatus*`, `PineBox`, `PineEditorStatus`, `RunsOnLine`, `SharePanel`, `api/services/pine_*`, `runtime_*`, `docs/pine/**` | a row in `requests.md`, with a repro command and its output |
| Indicators (authoring) | `builder/authoring/**`, `builder/studio/**`, `ChartSettingsIndicators.jsx`, `ChartToolbar.jsx`, `ChartPane.jsx`, `legend/chipMenu.js`, `/converse`, `/propose` | a row in `docs/indicators/INDICATORS-BACKLOG.md` |
| Screener | `api/services/screener/**`, `api/routers/scan_run.py`, `components/screener/**`, `pages/screener/**` | `requests.md`, territory Screener |
| Agent | `agent/**` | `requests.md` |
| Support loop | `chart/supportLoop/**`, `indicator_support*.py`, `tools/support_loop/` | `requests.md` |
| Formulas pages | `pages/formulas/**` | a pull request |

**This track's own code** is new and collides with nothing: `app/src/components/indicatorKit/**`
(renamed from v8's `components/studio/`, which sat beside the unrelated `builder/studio/`),
`api/services/indicator_kit/**`, `docs/pine/studio/**`.

**How this track changes another owner's surface.** The Pine engine's paths are read-only:
ask, never edit, never bump the engine version. Everywhere else this track may write the
change itself as a small pull request, after adding the row to that owner's list, and the
owner reviews it. That is how the interface work in section 6 gets built without waiting on
six queues.

**A request exists only once its row is on master.** v8's twelve requests were written on
an unmerged branch and half were in the wrong list; section 10 re-files them.

**Shared files every lane touches, one small additive edit each:** `Dockerfile.web` and
`docs/feature_flags.json` (a flag needs both, and three CI tests check the pair),
`persistenceManifest.json`, `requests.md`. New API routes declare their own `require_paid`.
Nothing this track adds may reach the entry chunk.

**Machine rules.** One heavy job at a time through the heavy lock, named test files, one
worker, a sparse worktree. Tests of this track's own code stay engine-free.

## 5. One name, one verdict

**One name.** The member-facing word is **indicator**, everywhere: the Builder's title, the
saved list, the library, share pages, the navigation. Today one object is called an
indicator, a formula, a script, a scan, a screen, a study and a definition, and a member
who builds an "indicator" finds it saved under "Your formulas" and browsed in a "Formula
library". "Formula" survives only as the name of the typed-expression mode ("Write a
formula"). "Scan" and "screen" remain the Screener's words for running one over a list.

**One verdict, from two places, never a third.** v8 said the status panel's headline is the
only verdict a member sees. That is not true today: at least seven surfaces state whether a
script runs (the status panel, the "Runs on" line, the saved row's stamps, the engine-status
answer on a saved-script upgrade, the capability detector, the door's notes, and the
harness grades, which are internal). The rule that can actually hold:

- For text being edited, the verdict is `editorStatus()`.
- For anything saved or shared, the verdict is the served row (its stamps and server lanes),
  which `editorStatus` already folds in when it is given the saved row.
- Every surface this track builds reads one of those two and computes nothing of its own.
  It shows the door's notes word for word.

**Three more member-facing terms, and no others:**

| term | meaning |
|---|---|
| Withheld | The engine did not draw a value because it cannot compute it the way TradingView does |
| UCT data | A value from our own data, not TradingView's. Shown by name beside the value |
| Adapted copy | A rewrite by the assistant of a script the engine does not run (section 13) |

Never "Valid", "Converted", "Verified" or "Supported". A model's description of its own
output is labelled "What the assistant says it wrote" and sits below the engine's words.

## 6. The experience blueprint

**The home is the Indicators window that already exists** (the chart's gear, Indicators).
No new door and no new toolbar button: a labelled "Indicators" toolbar button was removed on
purpose, to end two entry points onto one job, and it stays removed. The command palette
and the keyboard shortcut are the fast ways in.

**The window, as a member reads it:**

| part | content |
|---|---|
| Left | "On this chart": what is drawn now, with hide, settings, remove |
| Search | one box over everything: indicators, functions, members' indicators |
| Tabs | **On this chart** - **Mine** (built, pasted, installed) - **UCT** (the house set, section 9 lane H) - **Members** (the published library, shown here; the page remains for links) - **Standard** (technical, fundamentals, breadth, symbols, positioning) |
| Primary action | one button, **+ New indicator**, opening four rows: *Describe it* - *Paste a TradingView script* - *Start from a picture* - *Write a formula*. Each opens the surface that already exists |
| On each of Mine | Edit - Run over a list - Share - History |
| Footer | "Look up a function", opening the reference filtered to what is in the search box |

**First run.** The first time the window opens, one card sits above the list: "Describe an
indicator in plain words", with three trader-shaped examples (the RS line against the index,
distance from the 50-day in ATRs, volume above its 50-day average). One tap previews it on
the chart the member is looking at.

**While it works.** The preview takes about 14 seconds today and shows only "thinking". It
gets staged text (understanding, building, drawing), a cancel, and the allowance left.

**Empty and refused states, each with one next step:** nothing in Mine offers the three
examples; an empty Members tab shows the UCT set, never "publish yours"; a search with no
result says "Nothing called X. Describe it instead" and carries X into the dock; a refusal
names what is missing and offers the nearest thing that can be built; the allowance message
gives the reset time; after an install the member is told where it went and offered "Put it
on this chart".

**Command palette.** Add an indicator - Describe an indicator - Paste a TradingView script -
My indicators - Browse members' indicators - Look up a function - Run an indicator over a
list; and every indicator by name.

**Phone and tablet (1024 px and below).** The phone's indicator sheet gets the same search,
the same tabs as a strip, and "+ New indicator". The dock becomes a half-height bottom
sheet, so the chart being previewed stays visible, expandable to full height. v8 said
"full-screen sheet"; that would hide the chart.

**Commitments, each with a check that can fail:**

| # | commitment | check |
|---|---|---|
| X1 | Actions from a chart to each job, on desktop and on a phone: J1 two, J2 three, J3 two, J4 two, J5 three, J6 two | counted on production per job, before and after |
| X2 | Every job is in the command palette by its member name | each palette row opens its surface |
| X3 | Time from a chart to a first previewed indicator, for someone who has never used it | timed with the owner; the target is set from that run, not chosen now |
| X4 | Every surface works at 390, 820 and 1200 px | used, not just rendered; failures named by element |
| X5 | No dead ends | the states table above exists per surface, each state with its sentence and its action, and each is reachable in a test |
| X6 | One name | a sweep of rendered text for "formula" outside the typed-expression mode |
| X7 | One verdict | a sweep for the banned words; every verdict traced to one of the two authorities |
| X8 | Nothing saved, shared or charged without a press; Undo on every preview | each such action traced to a press |
| X9 | Keyboard: palette, Enter, Esc, focus returns where it was | walked |

The owner looks at each surface rendered, at three widths, before it ships. Mock-ups come
first: three directions for the window and the first-run card, the owner picks one, and it
is varied from there. A reviewer model's pass is not that look.

## 7. The intelligence and learning architecture

**What "learning" means here.** We do not retrain the assistant's model, and nothing in
production rewrites itself. The system gets better because every answer is stamped with the
exact version of everything that produced it, every use leaves a signal, signals are ranked
automatically, each top item is fixed in the layer where it belongs, and no fix ships
without passing a growing set of graded cases. It works because the engine, not the model,
computes the answer, so there is always something to grade against.

**How the assistant works today (read in code).** A constant instruction block plus the
vocabulary generated from the engine's own table, cached; five delimited data blocks per
turn (the request, language notes, the indicator as it stands, state, recent turns). A
model-free planner first grounds the member's terms against the firm's cited concept
vocabulary. One model, at most two calls a turn (one answer, one repair), one forced tool
that can only emit a patch, checked by five validators. The browser applies the patch and
the engine writes the words. There are no worked examples in the prompt and no record of
which prompt produced which answer.

**The mechanisms, in build order.** L1 comes first because every other one depends on it,
and because rows written before it exists can never be attributed.

| # | mechanism | what exists | what is built | owner, size |
|---|---|---|---|---|
| L1 | **Version stamps on every turn**: a hash of the instructions and tool, the vocabulary version, the model, the engine version | nothing | four allow-listed fields on the turn row | Indicators, small. DO FIRST |
| L2 | **Regression gate**: any change to the instructions, the vocabulary or the model carries a before and after from the evaluation runner; the free scripted mode on every change, a paid live run on a model or instruction change | the runner and its gates | the rule; more cases; colour and definition assertions; stamps in its records | Indicators + this track, small |
| L3 | **Colour registry**: one shared map of colour words to colours, given to the model and used by the read-back; and a check that if the member said a colour, the result reads back as that colour, else the one repair is spent | the read-back's own name list | the shared file and the check | Indicators, small |
| L4 | **House definitions**: a term means one thing. The chart door gets a per-bar twin for every scalar the Screener already defines, derived from the same definition and proved equal by a value test | the cited concept vocabulary; one twin | the twin registry and its parity test | Indicators, about a hundred lines a term |
| L5 | **Worked examples, retrieved**: a committed set of request, reference patch and hash, admitted only when owner-approved and passing as an evaluation case; the two or three nearest are placed in a data block, leaving the cached block untouched | nothing; a full-text retrieval precedent exists elsewhere in the repo | the store, retrieval on the planner's terms, the admission rule | Indicators, medium |
| L6 | **Demand mining**: what members ask for that cannot be built, counted by distinct member, ranked in the daily digest that already exists, and routed to the engine's demand ranking or the vocabulary | an "unsupported" category with a large remainder; the digest | the planner's closed keys and gate codes written to an aggregate table | Indicators + support loop, medium |
| L7 | **Was it wanted**: undone, tries before save, and still stored or on a chart seven days later | discarded, saved, turn count | an "undone" action, a hashed id on "saved", a nightly join | Indicators, small |
| L8 | **"Send this to UCT"**: one press sends the request, the indicator, the patch and the read-back, with consent, retention and deletion | the consented report door for Pine imports | a "converse" kind on the same table and dialog, not a new one | support loop + Indicators, small |
| L9 | **Later, when volume exists**: two instruction versions side by side by member bucket; a cheaper model for simple edits to an existing indicator, only after parity on the evaluation set | cohorts | - | deferred; underpowered and risky before L1, L2 and real use |

**Risks named once.** Examples are never admitted from member traffic automatically
(poisoning). The hidden evaluation set is written and run by a session that never edits the
instructions, and replaced each quarter (contamination). Keys written to telemetry come
from closed sets only, never free text (privacy). A registry twin is derived from the
column it mirrors, never restated (two authorities).

**What to capture now, because it cannot be captured after launch.** While the only users
are the builders, who can consent for themselves: full transcripts of our own sessions as
evaluation cases; an owner-graded reference for each house indicator; the hidden set sealed
before any tuning; and one baseline live run on the first stamped version.

**The scoreboard.** One line a day, read from what is recorded, added to the existing
rollout report and its M1 to M5 limits rather than kept as a second set:

| metric | from |
|---|---|
| built in one turn; needed the repair; which check caught it | turn rows (today) |
| saved, discarded, turns to save | action rows (today) |
| what could not be built, by class, and how much is still unclassified | turn rows (today); falling "unclassified" means the taxonomy is learning |
| median cost, p95 time | turn rows (today) |
| undone; kept after seven days; time to preview | after L7 |
| values agree with independent numbers; refusals were honest | evaluation runs only. A count of refusals in production is not a measure of honesty |

Every line carries the L1 stamps, so a drop is traceable to the change that caused it.

## 8. Opening it to everyone

**What "open" needs, read in code.** Setting the flag and tagging today's accounts does not
do it: admins (the builders) see the door only through a per-browser switch and their
cohort tag is ignored; accounts created later are never enrolled; and the status panel is a
build-time flag with no per-user stage.

| # | step | where | reversal |
|---|---|---|---|
| O1 | Enrol at sign-up and seed existing accounts once at boot, copying the pattern already on master for another feature | `rollout_gate.py`, sign-up, boot | remove the tag; no redeploy |
| O2 | The door's client check accepts the cohort for admins as well as the browser switch | `createIndicatorFlag.js` | revert |
| O3 | `CREATE_INDICATOR_COHORT_ENABLED=1` on web; the ledger row moves from pending to armed in the same change | env, `feature_flags.json` | unset: read first on every call, so new turns stop at once |
| O4 | `VITE_PINE_EDITOR_STATUS=1` at build; request R2 (an admin-only stage) is no longer needed | `Dockerfile.web`, ledger | rebuild without it |
| O5 | Rehearse the reversal of O3 once and record how long it takes to act | - | - |
| O6 | Set the per-member daily allowance and the shared interactive reserve on purpose. The reserve is one pool shared by every model feature, admins and this track's own measuring runs, and it is smaller than one admin's cap: a measuring run can pause the assistant for everyone for the day | env | - |
| O7 | Split credit and authentication failures from transport failures, so an outage is not read as a billing problem (Indicators backlog item 4) | Indicators | - |

**Not opened yet, and why.** The runtime lane for every account
(`PINE_RUNTIME_STAGE=all`) waits for the capability detector's worker to be on: the ledger
records the detector as able to hold the process on an adversarial script. Reports
(`PINE_SUPPORT_REPORTS_ENABLED`) open with L8. Unpaid accounts stay closed.

**What the adversarial review found safe.** Spend is bounded by a hard daily reserve and a
per-member cap that cannot parse to unlimited; an unknown model is priced at the dearest
rate; scripted sign-ups reach no model; the model has one tool and no other member's data;
member text renders as plain text; another symbol is refused before the model.

**Launch-readiness: before real members arrive.** Cheap now, costly later.

| item | why |
|---|---|
| The phone layout of the dock (section 6) | today a fixed 360 px panel |
| An admin takedown, a per-author publish limit, and a licence line on publish | none exists; a TradingView port keeps its licence |
| The allowance message says when it resets; the hourly message names the right feature | today neither does |
| Spend recording that fails closed: if a spend cannot be recorded, further calls are refused | today an unrecorded spend advances no cap |
| A separate budget lane for measuring runs and admins | section O6 |
| The paid evaluation run and the value-correctness check | no build has had its values checked |
| The hidden set, run by a separate session | not yet run |
| The capability worker on, then the runtime lane for all | above |

## 9. The work, in phases

Every lane names an owner and a proof that can fail. "By" is who writes the change: "this
track" means a pull request written here and reviewed by the owner (section 4).

### Phase 0. Unblock (hours)

| lane | work | proof |
|---|---|---|
| 0a | Merge this plan. Someone authorised must do it: this session's merge was refused by policy | the plan and its requests are on master |
| 0b | Re-file the requests in the right lists, with repro commands (section 10) | each row is on master in its owner's list |
| 0c | Rebase the two local code branches onto master; run their engine-free tests through the lock for the first time | the three test files pass, with a totals line |
| 0d | Ship the reference placeholder fix | 0 placeholders on the rendered page |

### Phase 1. Open it and make it measurable

| lane | work | by | proof |
|---|---|---|---|
| O | Section 8, steps O1 to O7 | this track, Indicators reviews | a brand-new account and an admin with no browser switch both reach the dock; the reversal acts within the rehearsed time |
| L1 | Version stamps | this track, Indicators reviews | every new turn row carries all four stamps |
| F1 | The first-run card and its three examples; staged wait text, cancel, allowance line | this track, Indicators reviews | X3 timed with the owner |
| P1 | Indicator commands in the command palette | this track | X2 |
| C1 | Capture (section 7): our own transcripts as cases, the baseline live run, the hidden set sealed | this track; the hidden set by a separate session | the baseline numbers exist, stamped |

### Phase 2. One place

| lane | work | by | proof |
|---|---|---|---|
| M0 | Three mock-ups of the window, the "+ New indicator" menu and the first-run card; the owner picks | this track | the owner's pick, dated. Nothing below is built before it |
| N1 | One name: "indicator" across the Builder, saved list, library, share pages, navigation | this track; Indicators and formulas pages review | X6 |
| H1 | The window: Mine, UCT and Members tabs, the "+ New indicator" menu, the states in section 6, the install receipt | this track, Indicators reviews | X1, X5 |
| H2 | Phone: search, tabs and "+ New indicator" in the phone sheet; the dock as a half sheet | this track, Indicators reviews | X4 |
| V1 | History beside Undo in the dock, reading the existing history door | this track, Indicators reviews | a member returns to an earlier version without leaving the dock |

### Phase 3. Make it smarter

| lane | work | by | proof |
|---|---|---|---|
| H | **The house set.** About twenty indicators traders build first, each described to Create Indicator and recorded as built in one turn, needed refinement, or could not be built. The owner looks at each on a chart. Approved ones fill the UCT tab and become worked examples (L5); each failure is a ranked gap | this track; the owner approves each | at least 12 of 20 approved by the owner; every failure filed in its owner's list |
| L3, L4 | Colour registry and house definitions, starting with the two errors already measured (a requested green came back teal; "ADR %" used a nonstandard definition) | this track, Indicators reviews | both cases are evaluation cases and pass; the parity test fails if a twin drifts |
| L2 | The regression gate becomes the rule | Indicators | a change to the instructions without a before and after is refused in review |
| L5 | Worked examples | this track, Indicators reviews | the baseline one-turn build rate rises on the evaluation set with examples on, with no fall on the hidden set |
| L6, L7, L8 | Demand mining, the wanted signals, "Send this to UCT" | this track; Indicators and support loop review | the daily digest ranks authoring gaps; a sent report is retrievable and deletable |

### Phase 4. Fill the real gaps

| lane | work | by | proof |
|---|---|---|---|
| R1 | **Run over a list, from the chart.** A row action on each of Mine and on the legend chip, opening the existing run flow with the indicator already chosen; the "No scannable formulas yet" state offers it. A numeric line goes through the existing threshold builder | this track, Screener reviews | X1 for J5; a run started from a chart finishes with the existing receipt |
| R2 | **Pine names in the reference.** First cut straight from the generated name coverage that already exists, so it is current by construction: every Pine built-in, whether it runs, and the reason when it does not. Then this track's measured layer on top: the answer at the chart door under each access profile, stamped "measured at N, current M" and hidden per name when stale | this track; formulas pages review | a Pine author finds `ta.rsi` and `request.security` and reads whether each runs |
| R3 | **A downloadable reference** generated from the same data, for members who write Pine with their own assistant, and "Paste what your assistant wrote" as the path back in | this track | the file regenerates from the data with no hand edits |
| R4 | **The verdict on a shared indicator.** The saved row's verdict and the engine version on the share preview and on install | Pine engine (request) | the installer sees the headline the author saw |
| R5 | **Inspect a bar.** For a pinned bar, the value of every named top-level variable in the script, with "why is this empty" linking to the line. Built by deriving a probe copy of the script that plots each named variable, running it through the same door, and reading the columns: no new engine internals. The engine provides two small exports: a headless "definition to columns for these bars", and the script's top-level names with line numbers. Stated limits: no variables local to a block; the probe's own verdict is shown if it differs | this track; Pine engine for the two exports | on 20 scripts, plotted values equal the legend, and each inspected variable equals the same expression plotted by hand, on production |
| R6 | **Load time.** A budget for an indicator's time to draw, shown on library and share cards, and a refusal to publish over it | this track; Pine engine advises | the number on the card equals a fresh measurement |

### Continuous. The loop

Daily: the digest and the scoreboard. Weekly: the top three rows are routed to an owner's
list and the previous week's are checked closed. Proof: a row that was routed is closed with
a stamped before and after. This is the lane with no end.

## 10. Requests, re-filed

| id | was | now |
|---|---|---|
| R1 (verdict readable without React) | to the engine | WITHDRAWN as a blocker: the reference builds under the test runner as the existing coverage file does. Kept as a note on bundle size for when an in-app surface imports the verdict |
| R2 (admin gate for the status panel) | to the engine | WITHDRAWN: the panel opens to everyone (O4) |
| R3 (named intermediate values) | to the engine | REPLACED by two small exports (lane R5); `requests.md` |
| R4 (verdict on share) | to the engine | STANDS; `requests.md`, with the served-row fields named |
| R6 (the Pine name map) | to the engine | WITHDRAWN: `pineBuiltins.json` is that list |
| R7 (check the door against the cost and safety list) | to authoring | ANSWERED by the adversarial review; two gaps remain and are in the launch-readiness list (spend recording that fails closed; a separate measuring budget). Indicators backlog |
| R8 (paste mode, version list, report button, read-back first) | to authoring | folded into lanes H1, V1, L8; Indicators backlog |
| R9 (phrases refused before the model) | to authoring | CLOSED: none are |
| R10 | - | withdrawn in v7 |
| R11 (an "Indicators" toolbar entry) | to the menus | WITHDRAWN: the button was retired on purpose. The window is the map; the palette is the fast way in |
| R12 (four signals and a send button) | to authoring | REDUCED to what does not exist: "undone", a hashed id on "saved", the seven-day join, and a "converse" kind on the existing report door. Indicators backlog |
| R13 (new) | - | Screener: confirm lane R1 composes the existing run door and adds no second one; `requests.md` |

## 11. Decisions

| id | ruling |
|---|---|
| D1 | Adapted copies: built last, shipped only under section 13 |
| D2 | This track builds no new model door. The existing one keeps its own model and metering |
| D3 | The status panel opens to every account (was: admins first) |
| D4 | Sharing is for members. No public links |
| D5 | PROPOSAL, not a description: no hide-source control exists, and the last change to sharing went the other way (the source is disclosed). If hiding is ever built, its warning says the script still reaches the browser. A licence line on publish is in the launch-readiness list |
| D6 | The Studio session speaks for this track |
| D7 | No competitor material in this repository |
| D8 | Pine is the only scripting language; one runtime |
| D9 | Nothing is saved or applied without a press. (Synced shares do not exist; if built, an update is never applied silently) |
| D10 | This track's measured layer of the reference is opt-in and never fails an engine change. The base layer rides the generated coverage file, which the engine's own change already regenerates |
| D11 | Member text and script-drawn text render as plain text. Shares and listings are in the account-deletion manifest (verified). Takedown and a publish limit come before launch |
| D12 | Plain-English authoring is the existing patch-based layer. No second one |
| D13 | = rule P1 below |
| D14 | The home is the existing Indicators window. No new door, no toolbar button |
| D15 | A request exists once it is on master, in its owner's list, in that list's format |
| D16 | Create Indicator opens to every paid account now (section 8). The staged pilot is not followed before launch |
| D17 | House style, the commitments in section 6, and the owner's look at each rendered surface |
| D18 | The learning loop of section 7. No member text without a press; nothing rewrites itself in production |
| D19 | One member-facing name: indicator |
| D20 | One verdict from two authorities: the editor's status for text, the served row for anything saved |
| D21 | This track may write changes to non-engine surfaces as reviewed pull requests; engine paths stay read-only |
| D22 | Gating numbers are derived from a measured run, never chosen in advance |

**Rule P1, census before design.** No lane is designed until what already does that job has
been read in code, across `docs/indicators/`, `docs/pine/`, `app/src` and `api`, under more
than one name for the thing. Four times this plan designed something that existed: an
authoring dock, a reference page and library, a rollout plan, and a run-over-a-list
surface. Each time the search had been pointed at one folder.

## 12. What the competitor research adds, and where it is still thin

Applied in this plan: a palette-first entry and example chips (F1, P1); mine, shared and
house indicators in one list (H1); one input for describing and converting (the "+ New
indicator" menu); versions in the authoring header (V1); a populated library on day one
(lane H); a downloadable reference for members who use their own assistant (R3); a load
budget (R6); and, as the headline the competitor cannot match on the public record, **one
indicator runs on the chart, in a screen and in an alert**.

Where this product is already stronger: the engine, not a model, states what was built;
refusals are honest (29 of 30 impossible requests refused plainly, none answered with a
look-alike); and indicators already reach the Screener and alerts.

Owner decisions the research raises:

1. **Authors on the library.** Published indicators show no author, by an earlier decision.
   The competitor's library filled in weeks with named authors, saves and comments. Names
   and a save count are the smallest step; comments and rewards are larger.
2. **A setup wizard and voice input** in the dock. Not planned; say if wanted.

Not verified in the research, to be checked before any claim is made in public: whether
the competitor's custom indicators work on its phone apps, in its alerts and under replay;
the size of its daily allowance; its current price. Two other products' assistants (one
that writes and repairs Pine in the editor, one that checks its own output against a
screenshot and logs) were read from their public pages and not used hands-on.

## 13. Deferred, and what this track will not do

| item | returns when |
|---|---|
| Every plot as a screener column; intraday screens; per-run input overrides | Screener and engine work; the server interpreter serves screens |
| A model that writes Pine | Pine authors ask for it, or adapted copies are approved |
| Adapted copies | all eight conditions hold: a Pine-writing model that meets a measured bar on a hidden set (the bar derived from its first run); no output dropped; a line-by-line view of what changed before install; a forced "Adapted: " name and badge that travels with shares; the original refusal still counted in demand; never for strategies; offered only where the engine refuses; "your original now runs, switch?" when it later does |
| A separate community feed | not planned; the Members tab is the library |
| Side-by-side instruction versions; model routing | section 7, L9 |

This track will not: edit engine-owned files or bump the engine version; add a second
scripting language, runtime or authoring door; save or apply anything without a press; show
a model's description of its own output as a verdict; copy a competitor's documents,
formulas or members' scripts.

## 14. What has been measured

On production as the synthetic account, 2026-11-14, unless marked.

| finding | evidence |
|---|---|
| Impossible requests are refused honestly | 30 through the full turn: 29 refused naming what is missing, 1 correct clarifying question, 0 look-alikes |
| Nothing is refused before the model | 60 prompts through the model-free half: 0 stopped |
| Ordinary requests build in one call | 7 of 30 run; 7 built. Judged by reading the patch, by the session that wrote the prompts, not applied and not value-checked. This is thin |
| Two of those seven were wrong in a way a trader sees at once | a requested green came back teal; "ADR %" was built as range over close |
| The planner attaches unrelated terms on some sentences | "email ... at the close" read as the close series; it did not mislead the model on this set |
| Columns the app already has are refused at the chart door | institutional ownership, analyst targets |
| The hourly limit is 40 turns per member, shared between the two authoring doors, and resets on every deploy | read in code; a measuring run hits it |
| The reference page prints placeholders | 85 of 86 functions |
| The library is empty | seen |
| No test of this track's own code has ever run | the heavy lock was held throughout 2026-11-14 |

Not measured at all: whether a built indicator's values are right; subtle impossible
requests; the cost of a turn that builds; anything on a phone.

## 15. Resume here

**State at 2026-11-15.**

| branch | holds | state |
|---|---|---|
| `docs/studio-track-plan` | this plan | pushed; the pull request is open, checks green; NOT merged (this session's merge was refused by policy) |
| `fix/formula-reference-placeholders` | lane 0d | one local commit, not pushed, far behind master, tests never run |
| `feat/studio-s1-reference` | the measured reference layer (lane R2, second half) | one local work-in-progress commit, untested, not pushed; it carries an old copy of this plan and of `requests.md`, to be dropped on rebase; its folder is to be renamed `indicatorKit` |

Worktree: `uct-worktrees/studio-s1` (sparse). It holds an untracked copy of the six files on
the feature branch, identical when checked; remove it before checking that branch out.

**Next, in order:** phase 0 (0a needs the owner or the coordinator), then lane O and L1
together, then M0, because nothing in phase 2 is built before the owner picks a direction.

**Open for the owner:**
1. Merge the plan's pull request.
2. Pick from the three mock-ups when M0 brings them.
3. The daily allowance per member and the shared reserve (O6).
4. Authors on the library (section 12).
5. May an indicator read fundamentals columns the app already has, as "UCT data"?
6. Approve each house indicator (lane H).

**Kept outside this repository:** the competitor review, prompt sets and results, the
hidden set, screenshots, and anything with cost figures.

## 16. What the six reviews changed (v8 to v9)

| review | what it found | change |
|---|---|---|
| Code census | Running a saved indicator over a list already exists end to end in the Screener; the Indicators window already has the authoring entry; a retired toolbar button was about to be re-requested; a support loop, a daily digest, a name-coverage file and version history exist; two decisions described features that do not exist; three names were already taken | Section 3 rewritten; S6 became lane R1; R11 withdrawn; D5 and D9 corrected; `indicatorKit` |
| Competitor research | Thorough on the product's internals, thin on its public side; eight captured findings had been dropped without a ruling | Section 12; lanes F1, R3, R6; two owner questions |
| Product and interface | Seven doors onto authoring, six names for one object, the library unreachable from the desktop navigation, no create door on a phone | Sections 5 and 6: one home, one name, a first-run card, a half-sheet dock |
| Model and learning systems | The evaluation runner is built, not just designed; no turn records which instructions produced it; the colour and definition errors have a systematic cause | Section 7: stamps first, the registries, retrieved examples, capture now |
| Engine fit | Seven verdict surfaces, so "one headline" was false; six owners, not two; half the requests were in the wrong list and none in the list's format; the inspector needs two small exports, not new engine internals | Sections 4, 5 and 10; lane R5; D10, D20 |
| Adversarial | Tagging accounts does not open the door for admins or for accounts created later; one shared daily reserve that this track's own runs can exhaust; the runtime lane must not widen before the capability worker; no takedown, publish limit or licence line; v8 still encoded the pilot | Section 8 and its launch-readiness list |

Earlier history, in one line each: v1 and v2 planned a new authoring dock and a Pine-writing
model; v3 found the dock already existed; v4 found the reference, library, share links and
templates; v5 added production measurements; v6 a resume point; v7 found the requests had
never reached master; v8 added the experience and learning sections and found the rollout
proposal.
