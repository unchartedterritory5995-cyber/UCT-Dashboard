# The indicator ecosystem: final blueprint (Studio track)

FINAL v9, 2026-11-15; progress and the house-set runs added 2026-11-16 (sections 14a
and 15, which a later session reads first; section 15 was brought up to date that evening). This version is a rewrite, not a ninth layer. v1 to v8 were each
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

**Before a push: a local failure is compared with a recorded list, test by test.** The sparse
worktree has no script corpus and no workflow files, so about ninety browser tests under
`engine/ast` and a dozen door tests fail in it for that reason alone. On 2026-11-18 two NEW
failures in `engine/ast/namedIndicators.test.js` were read as more of the same and went to the
remote lane, which was red for them. The rule since: keep the list of tests that fail on an
unchanged tree (file AND test name), and after a change compare the new list with it. A failing
test that is not on the list is this change's until shown otherwise; "that directory always fails
here" is not a reading of it. The remote lane stays the verdict; this is what keeps a known red
from being sent to it.

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
| L10 | **Value cases (the sealed write evaluation)**: plain-words requests, each with the lane it belongs on, the answer the door gave on production, and an independent account of what was asked. Formula lane: a plain calculation written from the words, importing nothing of the engine, must equal what was built on every bar of a built market with deliberate ties. Wall lane: a request that cannot be served must be refused with the wall named in plain words. Script lane: the recorded script run through the member pane's own path and held to the same kind of calculation. A rule never learns from the door: its numbers are fingerprinted in the case and a change needs a reason with words quoted from the request. Each lane's threshold is written by its first full live run and is a ratchet. A hidden set is run by a separate session and only its scores come back | private, hand-driven rounds (about 190 requests checked by value in fifteen rounds, none of it in the repository); the runner compares an answer with a reference formula on the same engine | unit 1: `tests/fixtures/authoring/value_cases.json` (101 formula cases, 28 wall cases), `tools/value_cases/`, `tools/value_eval.py`, `tests/test_value_cases.py`. Then: the script lane, the live re-run with version stamps, the hidden set and "every capability word has a case" | this track; the Pine coordinator runs the hidden set. Unit 1 small, the rest medium |

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
| O4 | `VITE_PINE_EDITOR_STATUS=1` at build; request R2 (an admin-only stage) is no longer needed. **ARMED 2026-11-17** on `web` and on `web-front`: the bundle members load is built by `web-front`, which keeps its own copy of every `VITE_` variable, so the flag on `web` alone changed nothing a member sees. Seen on production with three pasted scripts, desktop and phone | `Dockerfile.web`, ledger | delete the variable on both services and redeploy `web-front` |
| O5 | Rehearse the reversal of O3 once and record how long it takes to act. **REHEARSED on production 2026-11-17, on the owner's go (his words: do anything like that at any time while there are no users).** Closing took about 80 seconds: the variable deleted, the web service redeployed, a fresh boot serving. Confirmed as the synthetic member: the sign-in payload no longer listed the cohort, so the browser hides the door, and a turn answered 403 in 0.1 s with no model call. Restoring took about 6 minutes: on web, `--set` does not restart the running image, it starts a full build of the production branch, so a restore is also a deploy of whatever production holds. After it the member's turn answered again. Not tested: setting the variable with deploys skipped and then `railway redeploy`, which should restore in the 80 seconds closing took. The steps, and the trap: (1) `railway variable delete CREATE_INDICATOR_COHORT_ENABLED --service web`; (2) ⛔ that STAGES the change and does not restart the pod, so the feature is still on: `railway redeploy --service web --yes`; (3) confirm from the POD, not from `railway variables` (a fresh boot in `/api/health`, and a Create Indicator turn answering the closed sentence as the synthetic member); (4) to restore, `railway variables --service web --set CREATE_INDICATOR_COHORT_ENABLED=1` and confirm a boot the same way. The time to act is one web deploy, not "at once" as row O3 says: the variable is read on every call, from a process that has to restart to see it | - | - |
| O6 | Set the per-member daily allowance and the shared interactive reserve on purpose. The reserve is one pool shared by every model feature, admins and this track's own measuring runs, and it is smaller than one admin's cap: a measuring run can pause the assistant for everyone for the day. **Both are set on the web service as of 2026-11-17** (read them with `railway variables --service web --kv`; the values are not written here). Admin turns and this track's measuring runs still count against the shared reserve, by the owner's ruling of 2026-10-07; today's measuring runs stayed inside it | env | set |
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
| R4 | **The verdict on a shared indicator.** The saved row's verdict and the engine version on the share preview and on install. The page-side spec (field names `headline`, `engine_version`, optional `headline_current`; one line under the name, above Install) is Indicators backlog row 43; the engine builds the fields to it | Pine engine (request) | the installer sees the headline the author saw |
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
| D23 | **Taken by this track on 2026-11-16 under the owner's "yes to everything, make the judgment calls"; each of D23 to D28 is reversed by saying so.** Names: the assistant's name is used when the derived one is unreadable (section 14b); the 2026-10-06 derived-name rule still governs short names |
| D24 | The house set is published on the value check of section 14b, before the owner's look. The owner's look still decides what stays: the set is one file and removing one is one line |
| D25 | On a tablet the open dock may cover the joystick's edge tab. Accepted: the dock is closed with one press and the tab is back |
| D26 | Authors on the library: a published indicator shows its author only if the publisher chooses to at publish time; the default stays no author. Not built |
| D27 | An indicator may read fundamentals columns the app already has, named "UCT data" in the dock and the reference. A lane of its own (Phase 4); not built |
| D28 | A paid evaluation run may be made inside the existing admin daily cap, once, to set the regression gate's baseline. Its figures stay outside this repository |

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
| Ehlers Super Smoother, Instantaneous Trendline and Cyber Cycle as named, checked indicators | a published statement of each recurrence can be READ (2026-11-18: the author's own site refuses automated fetches and no page that could be read states them). They are not written from memory. Until then each is built from a member's words with the name withheld, where its shape settles |
| A setting as a coefficient of linked running values written out by hand (a gamma the member can change inside their own accum2 to accum4) | the settle bound is recomputed for the member's value when it is bound, not read once from the numbers. (The Laguerre pair does not wait on this: `laguerre` and `laguerreRsi` take gamma as their argument and size their own restart from it, so their gamma is an Inputs field today) |

This track will not: edit engine-owned files or bump the engine version; add a second
scripting language, runtime or authoring door; save or apply anything without a press; show
a model's description of its own output as a verdict; copy a competitor's documents,
formulas or members' scripts.

One exception, made by ruling and recorded here: `fisher(length)` (2026-11-18) is a formula
function in the engine's shared expansion module, built by this track under the engine
programme coordinator's authorisation, with no engine version bump (its number is pending and
rides the next train) and no Pine name. It follows the SuperTrend and Parabolic SAR precedent.

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

## 14a. The house set, first run (2026-11-15, production, synthetic accounts)

Twenty descriptions of indicators traders build first, each put to Create Indicator. First
through the door's API, then through the REAL dock in a browser as a member, on a SPY and an
NVDA daily chart, looked at by eye. Nothing was saved. No value has been checked against an
independent calculation, and the owner has not yet looked.

**"Built" from the API is not "works".** The API returned a patch for 14. In the dock:

| outcome | count | which |
|---|---|---|
| drew and looks right | 5 | extension above the 50-day in ATRs; percent from the 10-week; inside and outside bars; an average-daily-range table; the previous week's high and low |
| drew, plausible, unconfirmed | 3 | distribution-day count; follow-through day; tight weekly closes |
| drew with the wrong colour | 1 | a trend-coloured average: asked green, drew teal (fixed by the colour words change) |
| drew something suspect | 2 | a flat base (a band filled across the whole chart, through a 35 percent decline); gap ups (stray full-height dashed lines) |
| did not draw | 5 | both relative-strength-against-another-symbol requests; a trailing stop; volume bars coloured by day; an up/down volume ratio (built once through the API, failed twice in the dock) |
| refused honestly, with an alternative | 4 | two anchored VWAPs from a moving anchor; a value label with a line from a past bar; an earnings table |

**What it found, in order of weight:**

1. A marker or paint on an output that reads another symbol was refused outright. Cause:
   the gate marks that refusal "pending" (the other symbol's bars have not arrived yet), one
   function dropped the flag, and two gates read not-yet as never. A plain line against
   another symbol previewed in four seconds. Fixed in its own pull request.
2. **The assistant's names are thrown away.** It named every one of these well
   ("Distribution Day Count", "ATR Extension", "Tight Weekly Closes"). The dock showed
   "SUM 25 (1 when Close at or below 0.998 times previous Close and Volume above pr...",
   because a `create` always takes the name DERIVED from the formula
   (`authoring/derivedName.js`). That rule exists for a measured reason: a model-given
   "EMA 20" stayed "EMA 20" after "make it 50". It was written for one-line indicators; on
   anything longer the derived name is unreadable. Not fixed. A proposal is in the
   Indicators backlog; it needs the authoring owner, because it changes a safety rule.
3. Read-backs are nested formula English ("1 when (the 10-bar exponential average ...) and 0
   otherwise"), not a sentence a member can check their request against.
4. The same request does not always get the same answer.
5. A refusal shown to a member uses engine wording (`sym('SPY', ...)`).
6. Real capability gaps: an anchored VWAP from a moving anchor; a text label with a value;
   a line that starts at a past bar; fundamentals in an indicator.

**Consequence for lane H.** Nothing is ready to publish as a house indicator. The order is:
the marker fix (1), then names and read-backs (2, 3), then run the set again. A house
indicator is published only after the owner has looked at it on a chart.

**Also measured:** a turn that builds costs about seven times a refusal, so the daily
allowance was raised (the numbers are environment values, not recorded here). On a phone
the indicator library offered "New formula" and no way to Create Indicator at all.

## 14b. The house set, value check and the UCT tab (2026-11-16, production and real bars)

The twenty descriptions a third time, through the door as the synthetic admin, and then every
output checked against an independent calculation.

| outcome | count |
|---|---|
| builds | 15 |
| refused honestly, with the nearest thing that can be built | 4 |
| fails after its one repair | 1 (a marker on the highest-volume day of the year with a line at its close; backlog) |

**Values.** Each of the fifteen was evaluated by the server's own evaluator over real SPY and
NVDA daily bars (300 each) and compared, bar by bar, with a calculation written in plain
Python from the description, using no engine code. All 57 output series agreed on every bar.
The one disagreement in the first pass was in the reference, not the engine: "bars since" a
condition answers its window when the condition has not been true that recently, as its own
declared sentence says.

**Correct values are not a correct definition.** Two of the fifteen compute exactly what
their formula says and are still not what a trader means:

- a follow-through day with no upper bound on the days since the low marks every strong up
  day on higher volume once no low is in the window (14% of NVDA's bars);
- a flat base as "a range under 15% over five weeks" is true on 99% of SPY's bars.

Both were left out of the first set. A value check cannot find this; reading the hit rate
against what the pattern should be did.

**Rebuilt from tighter descriptions the same evening.** The flat base (a 25-session range
under 15%, within 15% of the 52-week high, after a 20% advance) equals a plain calculation
on every bar and is true on 6% of SPY's and 12% of NVDA's last 300 bars; it joins the set
(#1501). The follow-through day ("from day 4 through day 12 after the 50-session low")
built, read back plausibly, and **could not fire on any bar**: the assistant compared
`lowestbars` with negative numbers, TradingView's convention, and here that count is 0 or
more. Only the comparison with an independent calculation showed it (0 marks against 1 and
8). The door now refuses a bars-back count compared with a negative number and says why
(#1499). Asked a third time in the door's own terms ("made 3 to 11 bars ago"), the
assistant wrote `-lowestbars(low, 50) >= 3`: the same belief, negated, and dead again. The
rule is now the sign rather than the minus, and the prompt states the convention up front
(#1506). The indicator is rebuilt once that is served. The lesson is general: **a built
indicator with a plausible read-back can be wrong in a way only a second calculation
shows**, so nothing joins the house set without one.

The up/down volume ratio was built again and the assistant answered with a patch the
engine accepts; both outputs equal a plain calculation on every bar and it joins the set
(#1507). The set is thirteen.

**The follow-through day, fourth build (2026-11-17).** With #1506 served, the plain
description built correctly on the first attempt and with no repair: `lowestbars(low, 50)`
between 4 and 12. It equals a plain calculation on every bar and marks 3 of SPY's 700 daily
bars and 16 of NVDA's. It joins the set (#1527); the set is fourteen. Adding it showed a gap
in the value rail itself: on the default test bars the condition never occurs, so agreement
would have been 0 equals 0 on every bar and would have passed the two builds that could not
fire. The rail's own check that a condition must happen on the test bars refused it, and a
rare condition now gets bars on which it occurs.

**A look at all fourteen on a real chart (2026-11-17, production, AGL daily).** A value
check says the numbers are right; it does not say the picture is. Twelve draw as described.
Two computed correctly and drew badly, and both were rebuilt through the door (#1534):
the relative strength line sat flat because its 0 or 1 new-high flag shared the pane's
scale (now the line and its average only); the gap-up indicator's 20-bar low line was drawn
joined across the bars where it has no value (now a marker only, "Gap Up on Volume"). The
two causes are the chart engine's and are in the backlog for its owner. So a house
indicator passes three things, in this order: the formula says what was asked, the values
equal an independent calculation, and it has been looked at on a chart. The owner's look
is still the last word.

**One press (#1532).** "Add to chart" in the UCT tab saves the member's copy and puts it on
the chart as soon as the chart knows it (it was Install, a wait, then Put it on this chart).
A member who already holds an unchanged copy gets that copy, recognised by its maths, so a
second press no longer leaves two identical indicators.

**Correction, 2026-11-17 04:00Z: the plain-words box is gone from the Indicators window.**
Seen in the owner's own browser. The layouts release served at about 02:12Z gave the window
one header button, "Create indicator", by the owner's choice; the box that #1500 made send
on Enter no longer exists there. Every sentence above about Enter sending, and the count of
four actions, describes the build served from 00:31Z to 02:12Z. From a chart to a first
preview has to be counted again on the current window before any number is quoted.

**Checked on production, 2026-11-17 03:45Z (served f2a0d35916).** One press: 0.7 seconds from "Add to chart" to the indicator on the chart, with the toast naming it; on a second visit the row said the member has it, and a second press added that same copy (one definition, not two). The two rebuilt indicators were photographed on a chart again: the relative strength line has its shape, and the gap-up shows its marker with no line across the chart. Every copy made by these checks was deleted.

**The set.** Eleven are in the UCT tab (#1496), and the flat base makes twelve (#1501): distribution day count; relative strength
against SPY, and its new high before price; extension above the 50-day in ATRs; percent from
the 10-week; volume against its 50-day average; tight weekly closes; gap up on volume; inside
and outside bars; average daily range; the previous week's high and low. A twelfth, the 10
and 21 EMA trend, is verified and held back: the engine named one of its inputs
`ema21_csWidth`, and the repository's secret scanner reads that, in a field named `key`, as
a credential. The scanner's allow-list is the owner's to change (an attempt by this track to
add an entry was refused, rightly), so the indicator waits to be rebuilt or allowed. A
thirteenth (the up/down volume ratio) built through the door and was refused by the
browser's engine: the assistant answered "green shading above 1.2" with one colour state and
no other colour, which the engine refuses and the door had accepted, so the model never got
its repair. The door now applies the same rule (#1493); the indicator joins the set when it
has been rebuilt and checked.

**How a house indicator is held.** The definitions are produced by the shipped authoring
engine from the assistant's patches, never written by hand. `tests/test_house_indicators_values.py`
evaluates every output over deterministic bars against a plain calculation, requires each
condition to be true on some bars and false on others, and fails on an output that has no
reference, so nothing joins the set unchecked. Its first version failed for a real reason
worth keeping: bars that traded on market holidays put the weekly outputs a week behind,
because the engine knows the exchange calendar.

**Installing** saves the member's own copy through the ordinary save door under a fresh id.
It is theirs to rename, change in Create Indicator, or delete; there is no second kind of
indicator.

**Names and read-backs (#1495).** The dock keeps the assistant's name when the derived one is
longer than 28 characters or reads like a formula; a short derived name ("EMA 20", "RSI 14
above 70") stays and keeps following the maths. Under the engine's lines the dock shows
"What the assistant says it built", labelled as the assistant's; it is not sent back to the
model.

**Experience, first numbers (the synthetic member, 1500 px).** From a chart to a previewed
"Add a 20 EMA": five presses by way of Chart Settings (settings, Indicators, add, Create
Indicator, send), the dock open in 1.7 to 2.9 seconds, the preview 4.2 seconds after send.
Through the door alone, the house-set requests answered in a median of about 10 seconds; a
request that needed its repair took up to 26. X1's target for this job is two actions. The
Indicators window's plain-words box now sends what was typed (#1500). **Counted again on
production on 2026-11-17: four actions on the Charts page, not two** (settings, Indicators,
add, then type and Enter), because the Charts header has had no "Add to Chart" button since
the owner's header decision of 2026-11-11; where a chart shows that button it is two. An
earlier version of this paragraph claimed two without counting it on Charts. UCT Agent's
seeded door still never sends. Not yet counted on a phone.

**Checked on production, 2026-11-17 (synthetic accounts, nothing left behind).** The UCT tab
lists the set at 1500 px, and the UCT indicators sheet lists it at 390 and 820 px with 44 px
buttons and no sideways scroll. Install saved the member's own copy under a fresh id with
its name; "Put it on this chart" drew it; the copy was then deleted through the product's
own door. In the dock, Enter in the plain-words box sent the words; "Distribution Day
Count" kept the assistant's name while "EMA 20" stayed derived; "What the assistant says
it built" showed under the engine's lines. From Enter to the read-back: 10.3 seconds for the
distribution day count, 5.0 for a 20 EMA. One flaw seen: the "added" toast named the copy by
its id; fixed in #1518 (every member-made indicator had this, not only house ones).
Only one request was timed in the dock: the synthetic member's daily allowance was spent by
the day's other checks.

## 14c. What 2026-11-17 measured

Through the production door, as the synthetic admin, with requests the assistant had not seen
(relatives of the house indicators with other numbers and wording, and new ideas in the same
vocabulary). The requests and the per-request results stay local.

- **Every request built, with worked examples off and on, and the formulas read correct both
  ways.** A request for "ADR percent over 14 days" kept the house shape with the member's 14.
  The earlier door fixes (the bars-back sign, the one-colour state, the reference checks) are
  what made the difference; examples added nothing that could be measured on this set.
- **About one turn in four paid a second model call**, nearly always at one gate
  (`envelope:reference`). That, not build rate, is now the largest cost a member feels: a repair
  roughly doubles the wait. Indicators backlog 46.
- **A declared input cannot be a length.** Through the patch engine a declared input is applied as
  a level or a multiple and refused as a window. Settings for a built indicator therefore come
  from the formula's own slots (S1 above), not from the assistant declaring inputs.
- **A house term was recognised only by the Screener's own label.** Of fifteen ordinary
  phrasings, two matched. Fixed by L4's second part.

**The walk of 2026-11-17 (production, the synthetic admin, read-only, 1200 / 820 / 390 px).** No
horizontal overflow in the Indicators window or the New formula window at any width. The
palette lists all eight indicator jobs by their member names and closes on Esc with focus
back on the chart's settings button. Three things were found and are in hand: the cursor did
not start in "Describe it" (#1594); on a phone "Create indicator" was three taps deep and
below the fold (the phone sheet now leads with it); and the window opened by "Create
indicator" is titled "New formula" (Indicators backlog 49, an owner decision). Counting the
actions per job again, and the walk with the owner, come after these are served.

## 15. Resume here

**State at the end of 2026-11-16.** "LIVE" means used on production as a member (the synthetic
member account, in its own browser), not only merged. "Merged" means on master and waiting for
the deploy gate.

| lane | what | state |
|---|---|---|
| 0a, 0b, 0d | the plan, its requests, the reference page without `{0}` | DONE |
| O | Create Indicator open to every account | LIVE |
| P1 | eight indicator commands in the command palette; from any page they land on Charts | LIVE |
| L1 | version stamps on every authoring turn | LIVE |
| L3 | colour words: one shared value per word | LIVE |
| L4 | house definitions: `chart_twins`, seven Screener columns each proved equal to its column on the same bars; a Screener term ("ADR %") reaches the assistant with its house formula | merged (#1458) |
| L6 | demand mining: what could not be built, ranked by distinct members, in the owner report and the daily digest | merged (#1444) |
| L7 | undone previews and what produced each turn (LIVE); still stored a week after saving | merged (#1471) |
| L8 | "Send this conversation to UCT": a consented report through the support loop's door, withdrawable | merged (#1456) |
| F1 | the plain-words box first; the wait counts seconds and offers Stop; the allowance left, said once below half | LIVE; the allowance line merged (#1455) |
| V1 (first part) | History beside Undo, every earlier step one press away | LIVE |
| H1 (first part) | a Members tab in the Indicators window; on a phone and a tablet, Members' indicators in the library sheet | LIVE at 390, 820 and 1200 px (empty state only: nothing is published yet) |
| H2 | Create Indicator from the phone's library; the dock as a bottom sheet; above the joystick tab on a tablet | LIVE |
| N1 | a saved indicator is called an indicator: the Indicators window, the library, the builder's own list; X7, no verdict word, held by a rail | LIVE (slice 1); merged (slice 2, #1453) |
| X5 | a search that finds nothing offers "Describe it instead" with the words in Create Indicator's box | merged (#1454) |
| R2, R3 | TradingView names on the reference page; the reference as one file for a member's own assistant | LIVE |
| launch | library moderation (UCT takedown, a 20-listing cap per member, the licence line); spend that cannot be written still counts | merged (#1451, #1452) |
| tool | a refused turn tells an admin why each attempt was refused | LIVE |
| H | the house set: fourteen indicators in a UCT tab (window and phone sheet), each held to an independent calculation and looked at on a chart; one press adds one | LIVE with fourteen; one-press add and the two rebuilt are #1532, #1534 |
| N2 | the dock keeps the assistant's name where the derived one is unreadable; "What the assistant says it built" under the engine's lines | LIVE (#1495) |
| door | a one-colour colour-states patch is refused at the door, so the model gets its repair; so is a bars-back count compared across its sign, and the prompt states that convention | #1493, #1499, #1506 |
| X1 | the plain-words box sends what the member typed | SUPERSEDED the same night: the layouts release (#1477, the owner's Option 1 of 2026-11-16) replaced the plain-words box in the Indicators window with one "Create indicator" button that opens the New formula window's start view. #1500's send plumbing remains (toolbar, pane, dock) and nothing in the window calls it now; its window rail is skipped. It was live and checked on the build before that release |
| toast | the chart's "added" toast and Undo list name a member's indicator, not its id | LIVE (#1518): "Flat Base added" |
| spend | the picture door's prompt bound re-measured, so a reservation bounds the prompt again (a member's daily picture share now holds two worst-case reservations, not three; the owner may raise it). It turned the master deploy gate red for about 70 minutes: two Agent limit tests held the literal three. They derive the count now | #1509, #1522 |
| L4 (second part) | the words members use for a house term reach its definition ("relative volume", "distance from the 52 week high"); nineteen twins, each proved equal to its Screener column | merged (#1572) |
| L5 | worked examples: the nearest one or two house builds ride along as data for a new indicator. Built and dark. Measured on and off through the production door with new requests on 2026-11-17: every request built both ways, the formulas read correct both ways, and the share built without a repair did not rise. The bar in section 9 is not met, so it stays OFF for members | merged (#1563), OFF |
| L10 (unit 1) | **value cases**: 129 plain-words requests held to an independent account of what was asked, with no paid call: 101 on the formula lane (the recorded answer equals a plain calculation on every bar), 28 on the wall lane (the recorded answer refuses and names the wall). Controls: a formula two bars late, a neighbouring request's answer, a rule read late, a refusal that names nothing and a build where a refusal belongs each go red; a rule whose numbers change is red until the case records why. `python tools/value_eval.py` grades the record; `--answers <run folder>` grades a fresh run against it. Not yet: the script lane, the live re-run, the thresholds (written by the first full live run), the hidden set | this pull request |
| L10 (unit 2) | **value cases, the script lane, and a lane that holds the pull request**: 17 requests a formula cannot hold (a table, labels on bars, a line between two points, boxes, a count that carries state), each with the script the door wrote on production. The script is run through the member pane's own path in node (`tools/value_cases/script_lane.mjs`, the shipped engine modules) and held, columns and drawn things alike, to `tools/value_cases/script_rules.py`; a script that draws something the request did not name is a finding. `.github/workflows/value-cases.yml` runs all three lanes on any pull request that touches the door, the interpreter, the script reference and recipes, the engine or the cases, and a skip is a failure. Not yet: the live re-run with version stamps, the thresholds, the hidden set, and "every capability word has a case" | this pull request |
| L10 (unit 3) | **value cases, the live re-run**: `tools/value_record.py` sends the cases through the Create Indicator window on production as a synthetic account (the MEMBER-role one by default; nothing is saved; resumable chunks of 18 minutes; every row says which account answered it) and `tools/value_eval.py` grades the run: `--answers <run> --full --write` writes a lane's threshold the first time every case of that lane is answered (lane by lane; a later such run below it is red), `--adopt` makes ONLY the right answers the record, and `--stale` names the records made before a door file last changed (the instructions, the script door, the script reference and recipes, the engine number). On 2026-11-21 every record is stale by that measure, which is true: each predates that day's instruction changes. The first full live run (coordinator's ruling: lane by lane, once production serves the day's last instruction change and engine 93, 20 USD at most) writes the thresholds | this pull request; the run itself is owed |
| L10 (unit 4) | **value cases, every capability word has a case**: the script assistant is told it may use 29 capabilities (`pine_authoring.CAPABILITY_WORDS`); the recorded script cases use 13 of them, asked of the one detector (`pine_capabilities.capabilities_of`). The other 16 are named in the fixture (`capabilities_without_a_case`), a list that may only shrink: a NEW wording with no case is red, and a capability that gains a case must leave the list. One capability the recorded scripts use has no wording (`request-other`), named in `capabilities_used_without_words`. Closing the 16 means recording one script per capability live and holding it by value | this pull request |
| S1 | **a built indicator's numbers are settings**: every length, level and multiple is an editable field, derived from the formula at read time and changed by the ordinary slot edit (no model call, live preview, Undo). In the Create Indicator dock (#1583), and in the New formula window under what was described and on its Inputs tab, whose count had read 0 (#1589). All fourteen house indicators checked: every setting shown can be changed in one step | merged; per-chart values are the engine's (Indicators backlog 45) |
| R1 | run over a list from the indicator itself: a row on the legend chip and on each row of "Your indicators" opens the Screener's existing run flow on that indicator (`/screener?scan=<id>`, read once, removed through the router; an unknown or foreign id opens nothing) | merged (#1566, #1585) |
| R4, R5 | the page-side spec for the verdict on a shared indicator and the two engine exports for "Inspect a bar" are filed with repros; the engine builds to them | Indicators backlog 43, 44 |
| O7 | a credit or key failure at the model provider is told apart from a transport failure, and a member reads the platform's sentence, not a billing one | LIVE (#1555) |
| tool | an admin's turn that was repaired into a change says what the first attempt was refused for | merged (#1580) |
| polish | names in the New formula window follow the assistant's name (#1553, and #1564 for the close prompt it broke); "can't be drawn here" in a member's words (#1557); the scan-moved change is said (#1549); the spent-allowance message once (#1568) | merged |
| gate | five long-standing reds on master found while running the gate's own suite before merging, and fixed: four vision truth cases and the ledger-writer rail (#1562), the refusal-sentence truth case (in #1563) | merged |
| door | three deterministic mends before the door's check, so an answer whose maths is right does not pay a second model call: an output read by its key is written out; an assumption pointed at a slot that is not there keeps its words; one colour state on the candles or the background is re-spelled as the paint it means. Each is recorded by name on every turn | merged (#1590, #1601) |
| L4 (third part) | a Screener column the chart computes exactly is a term on the chart door, not "unavailable"; twenty-four twins | merged (#1588) |
| L2, C1 | `tools/converse_eval.py` builds again (an image type had no loader since 2026-11-12 and the runner graded nothing), with a rail that needs no bundler; and nine house indicators are regression cases beside the three examples, each run through the door, the engine and the grader (17 of 17 with the controls). **The rule:** a change to the door, the instructions or the vocabulary runs both offline commands first (`python tools/converse_eval.py --offline`, and the same with `--cases tests/fixtures/authoring/converse_eval_house_cases.json --script tests/fixtures/authoring/converse_eval_house_scripted.json`) and says so in its pull request; a change to the instructions or the model also needs the live run, which needs the owner's approval of the spend | merged (#1591, #1603); the live baseline waits for the owner; the tests run in no lane yet (Indicators backlog 51) |
| X1, X9, X6 | the New formula window opens with the cursor in "Describe it" on a desktop (#1594); "Create indicator" is the first row of the phone's Indicators sheet (#1596); a saved indicator's name keeps its line in the window's list (#1602); the formula reference speaks to a member in a member's words and no longer prints the engine's notes (#1605) | merged |
| V1 (second part) | an indicator saved more than once lists its saved versions in the dock's History; "Use this version" makes one the draft again as one undoable step, with a line that was deleted since coming back as a new line | merged (#1633) |
| S1 (second part) | the same number in several places is never merged; changing one offers to move the others of its kind that still hold the old value | merged (#1633) |
| share | Share on each row of "Your indicators" (the builder's own panel in a window of its own); the row keeps its name with five doors (they sit on a second line); the panel says "indicator" for one | #1628 LIVE; the words #1642 LIVE; the row's second line in #1642 did nothing on production (the doors are a child of the name's box, not of the row) and was redone in #1656: LIVE (#1656), measured on the served page at 1200, 900 and 700 px: the name whole, the five doors on their own line, nothing overlapping |
| X6 | the builder window is titled by where it opens: "Create indicator" / "Edit indicator" from a chart, "New formula" / "Edit formula" from the Screener (owner decision 2026-11-17) | #1642 |
| H2 (remainder) | phone and tablet: one "Showing" control in the indicator library, every list with its count (the owner picked mock-up B) | #1642 |
| O5 | the kill switch rehearsed on production: about 80 seconds to close, about 6 minutes to restore | DONE 2026-11-17 |
| tool | the evaluation runner's own tests run on pull requests with node present, and a skip fails | merged (#1634) |
| R4 | **the verdict on a shared indicator**: the engine serves `headline`, `engine_version` and `headline_current` on a share link, the install answer and a library entry (#1646); the page says it in one line under the name (#1651); and the author's browser puts the status panel's sentence on record when a pasted script is saved, through the script door or the form, and when a saved script is reopened unchanged (#1654). Never a sentence about a different text than the one saved | LIVE (#1646, #1651, #1654). Seen on production 2026-11-17 as the synthetic admin: a pasted script saved from the chart posted its sentence for version 1 under engine 71, the share link answered with it, and the share page read "Runs on the chart and in alerts; screens and scans need a threshold, checked on engine 71". The check removed what it made |
| R5 | **Inspect a bar**: under the script preview in the builder, the value of every named top-level variable on one bar of the chart, why an empty one is empty, and "line N" to its line. A probe copy through the script's own door, on the engine's two exports (`topLevelNames` #1647, `computeHeadless` #1649). The plan's proof is a test: on twenty scripts (53 variables) each inspected value equals the same expression written out by hand, on every bar of the 5,000-bar reference series | LIVE (#1670; a wording fix for scripts that read another symbol is #1685). Seen on production 2026-11-17 on a real daily chart (1,406 bars): each named variable with its line and value; its 50-bar average read 91.8878 where the chart's own SMA 50 legend showed 91.89; an early bar said "Its first value is on Jun 24, 2021, 37 bars after this one"; "line 6" took the editor to line 6 |
| R6 | **a load budget for the library**: when a member lists an indicator the server measures a formula with the engine's headless export (a work count over the reference series, never a clock), files it as light, moderate or heavy (0.10 / 0.25 / 0.50 of the lane's ceiling) and refuses a listing over half the ceiling; the same gate runs when a listed indicator's link is moved to a new version. Cards and the share page say the class; the share page adds the time on the viewer's device. A pasted script is not run on the web server: "not measured yet" until the script service measures it. Switch `DEFINITION_LOAD_BUDGET_ENABLED` | LIVE and ARMED 2026-11-17 (#1662). The driver was run on the web server first (the same count twice, about 0.35 s each); then, as the synthetic admin, listing a two-output formula answered "light" (4 of 16,384) in about 2.5 s, the library card and the Members tab card said "Light to draw.", and the share page added "Drew 5,000 bars in 2.5 ms on this device". The check unlisted it afterwards. The engine session reviewed it and caught one real gap before merge (a re-share of a listed indicator skipped the budget) |
| baseline | the live baseline of the evaluation runner, without a key on this machine: each case's first request sent through the production door as the synthetic admin, three rounds, and the real answers graded by the runner offline. All three rounds passed. It measures first requests only | DONE 2026-11-17 (requests, answers and spend kept outside this repository) |
| explore | the exploratory rounds the owner asked for after the plan: this track's own requests sent through the production window as a member would, each answer read for whether the formula is right, not only whether it built. Round 1 (single requests across the kinds members ask for) found the SuperTrend / SAR door defect (#1680) and four smaller ones (#1692). A multi-turn round (build, then change it four ways, as the admin and as a member) found that the commonest edit cost two calls (#1699) and that names and labels were shown as formula text (#1693, #1702). Round 2 (harder single requests) found the class in Indicators backlog 59: the server door accepting what the browser then refuses (#1701, #1708, #1722). The opening-range gap became engine vocabulary (#1713). Each fix was proved able to fail and the served ones were seen on production | rounds DONE 2026-11-17 (requests and answers kept outside this repository); backlog 54 to 64 hold what was found and what is left |

**The house set, second look (2026-11-16, production).** Of the five that did not draw on
the first run: both relative-strength requests draw (the marker fix); volume bars coloured
by up or down day and the up/down volume ratio now build on every try and draw correctly in
the dock (four of four through the door, then one each in the dock; nothing in this track
changed them, an engine release landed the same day); the trailing stop that only moves up
is now refused honestly, with the nearest thing that can be built, which is the right
answer: a line here has no memory of its own previous value. So of twenty: fifteen draw,
five are refused honestly, none fails. "Draws" is not "is right": the flat base and the gap
ups from the first run are still suspect, and no value has been checked against an
independent calculation. What blocks publishing is unchanged: names and
read-backs (section 14a, findings 2 and 3), and the owner's look.

Not finished, and why (as of the afternoon of 2026-11-17):

- **L5, worked examples**: built, measured on and off through the production door, and left
  off: no gain (see the L5 row above).
- **R1, run over a list from the chart**: done (see the R1 row above).
- **R4, R5 and R6**: built and merged on 2026-11-17 (rows above). What is left of each is stated in its row. For R6: the runtime lane (a pasted script) is measured only by the isolated script service, which is not deployed; until then such a listing says "not measured yet" and is never refused for load. The library holds no listings yet, so no card carries a class until a member lists a formula.
- **The live baseline run**: DONE 2026-11-17 (the baseline row above). It measures first requests only; the second turns of the multi-turn cases still need a model key on the machine, or a longer walk through the door.
- **H2, the remainder**: DONE 2026-11-17 (#1642). The owner saw the three mock-ups and picked B, one
  dropdown. The library sheet (the indicators surface on a phone and a tablet) has one "Showing"
  control naming every list with its count: all, on this chart, yours, UCT's, members', and each
  catalogue heading. The two door rows and their separate views with a way back are gone.
- **O6, a separate budget lane for admins and measuring runs**: a decision on its size is the
  owner's; today the shared pool was raised instead.
- From the launch-readiness list: the paid evaluation run and the hidden set (spend approval, a
  separate session), and the capability worker before the runtime lane for all (Pine engine).

**How the work is done here, learned the slow way:**

- Judge an authoring change in the real dock, as a member. The API's "built" was wrong for
  3 of 14.
- Look at a layout change on production at the size a member has. The History list passed
  every test and still pushed the footer off a short dock; a browser test cannot lay out.
  Try the rule on the live page with an injected style before writing it.
- The machine's heavy lock is not first-come. Queue a test in the background and keep
  writing on another branch.
- A deploy gate in progress is not cancelled by a merge; one still waiting is replaced by
  the newer one. Merge when green, merge everything that is ready in the same minute, and
  push once per pull request. (An earlier version of this section said every merge cancels
  the running gate. That was wrong.)
- Parse-check every file before queueing its test.
- A pull request's green lanes are not the deploy gate. Before merging a change to a cost
  constant or a prompt size, search the tests for the constant and run the gate's own list
  (`tests/test_uct_agent*.py`), not only the door's file. #1509 passed its lanes and held
  production for every session.
- A synthetic account's board can be changed by simply loading Charts. Since the 2026-11-16
  layouts release, an account whose stored layout pointer is still "uct-default" opens a
  blank board and saves it. The synthetic member is such an account: read its workspace
  head before a check and restore it after (`POST /api/workspace/doc/restore`).
- A worktree copy of a shared file can be behind master. Committing it as it stands undoes
  someone else's change. Compare with master and refresh the file before editing it.
- A `VITE_` build flag is set on `web` AND on `web-front`. The bundle members load is built by
  `web-front` from its own copy of those variables. Confirm on the live page, not from the
  variable list.
- "Try the rule on the live page" means the live page. #1642's row fix was measured in a page
  built by hand, whose markup was not the product's, and did nothing when served. #1656 was
  measured by loading the candidate rules into the real Indicators window first.
- A pull request's own checks do not run the engine folder, the builder folder or the app-wide
  reachability rail unless it touches those paths. #1662 and #1670 were green everywhere they
  were looked at and still turned two engine rails red on master (a path to the script lane with
  no switch on it; a new test folder nobody had acknowledged). Before merging a change that
  imports anything under `engine/` or adds a test folder under `chart/`, run
  `src/components/chart/engine`, `src/components/chart/builder` and
  `src/components/screener/reachable.test.js` on GitHub runners, and read every verdict line.
- A budget, a limit or a check belongs on the door that changes the thing, not on the button
  that usually leads to it. The load budget was first checked only at List; a re-share moved
  the listed version past it. The engine's review caught it before it merged.

**Done since (2026-11-17, late):** Indicators backlog 59 in three parts: the door/browser rail (#1734), the sweep that measures the class (`tools/door_browser_sweep.py`, measure-only) and the general fix (#1738: the browser sends its own refusal back to the door for one repair). A correction on the record: "Mansfield relative strength versus SPY over 52 weeks" was reported fixed after #1680 from the door's answer alone; the window had refused it. It is #1730. A live result is the window's text, never the door's answer.

**Next, in order:** see #1701, #1708, #1722, #1730, #1738 and #1713 on production with the requests that found them (the daily allowance is durable and renews at midnight Eastern, so re-checks queue for after it); backlog 63 and 64; the same request sent three times, to measure how often an answer changes; then names and read-backs with the authoring owner, the house set a third time, and the owner's look.

**State at the end of 2026-11-18.** One day's work on "anything a member can describe is built, and
what is built is what was asked for". Every row below is merged; "live" means used on production as a
synthetic account afterwards.

| what | state |
|---|---|
| Several LINKED running values (`accum2` to `accum4`): built from a member's words when their starting values provably stop mattering (a filter, or a chain), refused by name otherwise | live (#1863) |
| The door asks the ENGINE which shapes it computes: a running value inside a window function, under a bar offset or inside another running value is refused at the door, not accepted and then refused by the browser | live (#1895) |
| The library: 37 checked indicators. Added this day: Positive Volume Index, Fisher Transform (`fisher`), Laguerre Filter and Laguerre RSI (`laguerre`, `laguerreRsi`), Detrended Price Oscillator (`dpo`), Stochastic Oscillator (fast, slow and full in one entry), Pocket Pivot | live; the Stochastic merged (#1907); Pocket Pivot merged with this record |
| A new kind of evidence: an entry may FOLLOW UCT'S OWN READER. Pocket Pivot, held until now, is the chart formula of the Screener's own detector, proved equal to it bar for bar by a test that imports the detector and runs it. One authority; no member is told "published by" or anything about a vendor | merged with this record |
| Engine 79 numbered the four new functions; a function waiting on a number is marked in data and held to a line in the version file | live (#1891) |
| Clarify and learn: the door's own questions (no assistant call) now include the benchmark of a relative-strength request, how far back a breakout looks, and which Stochastic; an answer is remembered, used and said; a member's usual choices are offered first | live (#1866, #1890); the Stochastic's merged (#1907) |
| A function's high, low and close are put in the engine's order when an answer writes them in another vendor's (a Stochastic that was a different number on every bar); the weekly owner report counts saved indicators that carry it, and changes none. On production the report counts none | live (#1900, #1904) |
| The read-back names a bar-field argument by its role when it is not the bar's own field in order | #1909 (engine; the next train numbers it) |
| A decline offers the closest part of the SAME indicator; a stop that only rises is a running value, not a refusal | live (#1890) |
| The server spells small numbers as the browser does (an answer holding 0.000001 was refused twice) | live (#1886) |
| Several number lines of one indicator are drawn in several colours; a library indicator's lines carry the library's labels; colours are read back by name | live (#1877, #1890) |

| A name that is one of UCT's own built-in indicators (RS Rating, RS Phases) is answered with no assistant call and one button that adds it to the chart, for a browser that can; Mansfield Relative Strength says where it is today (a Screener column) | merged with this record |
| The same request sent three times through production, six requests of different kinds: every send built in one call; five gave the same maths on all three; one differed on whether an inside day's edges may touch the bar before | measured 2026-11-18 (answers kept outside this repository) |

**What is left, in order.**
1. The Stochastic's capture: TradingView's built-in at (14, 1, 3) and (14, 3, 3). Graded equal, the entry carries all three tiers and may say so.
2. The two HELD names. Mansfield Relative Strength waits on a built-in that draws the Screener's own column (a chart formula was ruled out: a second join, and different after a missing benchmark bar); the name then points at it with the one-tap offer. TTM Squeeze needs its author's formula on a page that can be read.
2a. The offer, extended: the rest of UCT's own built-in indicators and the house set by name ("bind the house set into the library").
2b. "Inside day" means one thing: the measurement above found two readings of it.
3. Super Smoother, Instantaneous Trendline and Cyber Cycle as named entries: a published statement of each recurrence that can be READ (section 13). They are built from a member's words today, name withheld.
4. An instruction slice, measured live before and after like every one: the assistant under-claims on a formula that needs a choice among several terms (it declined one the language can express).
5. The second turns of the multi-turn evaluation cases, and the same request sent three times (how often an answer changes).
6. A setting as a coefficient of linked running values a member writes by hand (section 13).

**Open for the owner:**
1. Look at each of the fourteen house indicators on a chart (Indicators, UCT tab) and say which
   stay. They were published on a value check, not on your look (D24).
2. D23 to D28 in section 11 were taken as judgment calls. Reverse any by saying so.
3. The 10 and 21 EMA trend indicator is held out of the house set by a false positive in the
   secret scanner (section 14b). Say whether to add an allow entry for that one identifier.
4. (2026-11-18) The admin accounts' daily allowance at Create Indicator is 30 on production, raised
   from the default 10 for the live checks (`docs/feature_flags.json`, `CONVERSE_ADMIN_CAP_DAILY`).
   Say when to put it back; a member's allowance was not changed.
5. (2026-11-18) The weekly report counts saved indicators that carry a function's high, low and
   close in the wrong order. It counts none today. If it ever counts some, say whether they are
   corrected for their owners or their owners are told; nothing touches a saved formula until then.

**Kept outside this repository:** the competitor review, prompt sets and results, the
hidden set, screenshots, the house-set pictures, and anything with cost figures.

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
