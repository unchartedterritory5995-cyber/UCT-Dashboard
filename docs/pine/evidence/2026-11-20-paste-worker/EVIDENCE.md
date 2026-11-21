# A paste builds off the page's main thread, once (evidence, 2026-11-20 / 2026-11-21)

Branch `feat/pine-paste-worker` (#2254), cut from master `4dae9f9e06` with #2225 (`fix/pine-door-deadline`, the one-window
door deadline, train e91) merged in, because the deadline runs inside the worker. The licence-held scripts this unit
measured are never committed: the rails use committed corpus scripts and fixtures, and the per-script rows stay in private
evidence (the coordinator has them). This page carries the method, the aggregates and the verdicts.

## 1. Answer first

- **The defect.** A paste ran three engine computations SYNCHRONOUSLY on the page's main thread: the member door
  (`memberPaneDefinition`) TWICE (`MemberPane.jsx` and the editor's status panel, `PineEditorStatus.jsx`; production
  bakes `VITE_PINE_EDITOR_STATUS=1`), PasteBox's own report (`inspectSource`, one more `translatePine` of the paste), and
  the status panel's status (`editorStatus`, a walk of every output through the lanes' gates). On the scripts the door
  serves, one door call takes 0.57 s at the median, 4.3 s at p90, 52 s at p99 and up to 157 s (#2225's census, dev PC).
  A deadline can only END a call; it cannot shorten one.
- **The fix.** Two workers, one per job kind, each spawned only when a member pastes:
  - the chart door's worker builds the door ONCE per script and page state (`memberPane/memberDoorAsync.js`, one keyed,
    shared build read by the pane and the status panel);
  - PasteBox's report worker makes the report (`inspectAsync.js`) and, from it, the status panel's status (the HUB,
    section 4): the door's worker sends its full answer to the report's worker over a MessageChannel the page sets up
    between the two, and the status is made where the full report and the full door answer meet.
  - What crosses to the page is what the page reads: the door's answer without its `translation`, the report without its
    trees and object program (`inspectView.reportForPage`), the status (a few KB). A Use asks the report's worker for the
    object program (section 4).
  - A newer job stops the running one; #2225's deadline runs inside the worker; a watchdog at that deadline plus 30 s
    stops a silent worker and refuses by name; a worker that dies refuses by name. While a build runs the pane keeps its
    picture, says "Checking your script...", and its Add waits.
- **Byte-identical.** Rails, every committed sample and every page state: the worker's answer, report, status and a Use's
  pick equal the main thread's field for field (sections 4, 8). The census on the real worker bundle: pending: it runs on the AFTER build of this head (section 6).
- **The main thread.** The first browser trace (AFTER `50514208a6`) did not meet the bar: script A spent 1.1 s in
  `editorStatus` inside a React render and up to 1.2 s receiving a 72 MB report; B's drawing was refused on 2 of 3 runs.
  The redesign moves the status into the workers and sends the page what it reads (section 5). Re-trace: pending, on the AFTER build of this head.
- **B's refusal is not this unit's.** It reproduces on MASTER: the door's answer is a function of how fast the machine
  got through the call (the translator's 10 s window swallowed inside a `catch`, and the VM's wall time in the door's
  probes). Root cause and the deterministic-budget fix are e93, its own engine-versioned PR (section 7).

## 2. The chart door in a worker

**One computation, in another module graph.** A worker is its own module graph: every module the door reads starts there
as it does in a fresh page, empty. The door is a pure function of its arguments and of six page states, and each is
imaged by the module that owns it (one authority over each value; `memberPane/memberDoorImage.js` only collects them):

| part | owner | what it holds |
|---|---|---|
| `lists` | `engine/runtimeKill.js` | the kill list, the starter allowlist, capability admission, this tab's per-script verdicts |
| `permission` | `lib/runtimePanePermission.js` | the member's latched runtime-pane permission |
| `evidence` | `engine/runHalfRailSeam.js` | the run half's object evidence |
| `libraries` | `engine/ast/pineLibraryStore.js` | the Pine libraries this page fetched |
| `hkd` | `engine/hostKnownDivergence.js` | the host lane's known-divergence list as consulted |
| `held` | `engine/heldWithholds.js` | the held withholds as consulted |

Everything else in the door's graph is a constant, a registration every graph makes when it loads, or a cache of a pure
computation; the build flags are baked into the worker's bundle by the same build. The registrations a chart page makes
when it loads (the run half's object rail, the host lane's `runtime.error` stop) are made by the worker's handler too
(`memberDoorWorkerGraph.test.js` compares the worker graph's registrations with the page's, with a control).

**The worker's graph is pure; the page's is master's.** `buildDefinition` and `evaluateFormula` / `canSaveFormula`
moved verbatim into pure modules (`builder/buildDefinition.js`, `builder/evaluateFormula.js`), re-exported from their old
homes. The page's imports are unchanged (its chunk graph is master's); only the worker's bundle resolves the door's
two sheet imports to the pure modules (`app/scripts/memberDoorWorkerPure.mjs`, scoped by exact importer AND exact
specifier, with a rail that fails on any other match and a control).

**What the build does to the page is done on the page.** The door's consults of the runtime lists have effects (a
re-read of the lists, an admission ask, the "still being checked" mark the pane's first-paste rule reads). The worker
records each consult and the page makes the same consults, in order, when the answer lands, before anyone reads it; a
warm of the runtime lane the door asked for is made on the page; `consultPending` is reported in the build's own state.

**What crosses.** Faithfully: every own field, non-enumerable ones included (they cross in a side table and are put back,
`memberDoorProtocol.restoreFaithful`); shared identity kept; a Map and a Set as themselves. The page reads the door's
answer WITHOUT its `translation` (`doorForPage`); the full answer goes to the report's worker (section 4).

**Never a silent hang, never a guess.** The door's own deadline (#2225, 5 minutes, one window per call) refuses by name
(`pine:timeout`) inside the worker; the watchdog (the deadline + 30 s) terminates a silent worker and refuses with the
deadline's own answer; a worker that dies is refused by name (`pine:door-worker`); a door that threw is refused by name
on the pane (`pine:door-failed`). With no `Worker` (tests, a non-browser host) everything runs on the thread, as before.

**Why not the runtime worker's bundle.** The door's graph imports `runtime/runtimeAsync.js`, which spawns
`runtimeWorker.js` (it would refer to itself), and it would grow the worker every runtime chart spawns by about 1.6 MB.

## 3. PasteBox's report in a worker

PasteBox's report (`inspectSource` / `inspectPine`, moved verbatim from `PineBox.jsx` into `builder/inspectSource.js`) is
made in the report's worker, once per text the member stopped typing on, by the same keyed service
(`inspectAsync.inspectService`); a paste of several scripts is read there too (`inspectLibraryService`). A report that
could not be made (a dead worker, the watchdog) is the controlled error report PasteBox's own `catch` showed.

## 4. The hub and the light report

- **The status where the full answers are.** `editorStatus(report, pane)` reads the report's trees and the door answer's
  `translation`. The report's worker keeps the last reports it made; the door's worker sends each full answer to it over
  the page's MessageChannel (`inspectAsync.linkHub`, set up again whenever either side starts a worker; the door's side
  sends its last answer again to a new port). The report's worker makes the status of a report alone (sent with the
  report) and with the door's answer for its text (sent when it comes), and the page reads a status by the report's key
  and the door answer's key and page state (`useHubStatus.js`). A door answer the page made itself (a dead worker, the
  watchdog) is handed to the report's worker once. While the status with the door's answer has not come, the status of
  the report alone stands, marked "checking".
- **The light report** (`inspectView.reportForPage`). PasteBox reads, of the trees and the program: each output's input
  placements (`placementsOf`), whether each column is a number (`numericOf`), the non-Pine verdict (`verdictOf`), of each
  read-back `ok`, `readback`, `guard`, `error`, and the program only when the member presses Use. The worker derives the
  first three from the full report, with the functions PasteBox uses for a report it computed itself, and sends the
  report without `objects`, without each output's `ast` and with each read-back cut to those four fields.
- **A refusal's stamp crosses once.** Every refusal is stamped with the text it was made of (so a suggestion is applied
  to the text the engine read); the worker sends a mark and the page puts the job's own text back.
- **Use.** A pick whose program stayed in the worker asks for it (`inspectAsync.askHeldObjects`); the button waits. A
  worker that no longer holds the report (a newer text stopped it) makes it again from the page's arguments and image; a
  question a dying worker did not answer is asked of a new one. Never on the page, except where no worker can be
  started at all.

## 5. Bytes posted to the page, per kind

Structured-clone bytes (`v8.serialize`, the format `postMessage` writes), BEFORE (what the page computed from or was sent
in the first cut) and NOW; `memberDoorBytes.test.js` holds the committed rows under a budget per kind (report 640 KB,
door 896 KB, status 64 KB, a Use's program 512 KB), and each budget is one the old messages break on at least one row.

KB, first cut (#2254 as first traced: the full report and the full door answer crossed, the status computed on the page
from both) -> now:

| script | report | door answer | status | a Use's program (on click) |
|---|---:|---:|---:|---:|
| artemis-oscillator-pro | 788 -> 332 | 829 -> 698 | (1,617 read on the page) -> 3.5 | 395 |
| camarilla | 527 -> 245 | 375 -> 0.4 | (903) -> 14 | 76 |
| chart-champions-part-1 | 754 -> 215 | 498 -> 0.9 | (1,252) -> 31 | 34 |
| atr-support-and-resistance | 165 -> 82 | 167 -> 127 | (332) -> 1.4 | 63 |
| twin-range-filter | 1,500 -> 553 | 1,009 -> 761 | (2,509) -> 1.4 | 0.1 |
| uncharted-clouds | 147 -> 127 | 391 -> 287 | (538) -> 1.3 | 0.1 |
| **A** (licence-held) | pending | pending | pending | pending |
| **B** (licence-held) | pending | pending | pending | pending |

What still crosses is what the page draws or shows: a door answer's definition and rows (the pane draws them: B's
6.2 MB of object program is the drawing itself and is irreducible while the pane is drawn on the page; running the
drawing program in the worker is a later investigation), a report's formulas, read-backs and placements (PasteBox shows
them and a Use carries them). A and B's rows are measured by the same rail on the developer's box
(`PASTE_BYTES_LOCAL`), never in CI (the scripts are licence-held).

## 6. Census

**Method (census v3).** BASE: master's code (`4dae9f9e06`, a `git archive` snapshot) on the main thread: PasteBox's
report, the door, and the status alone and with the door's answer. HEAD: the AFTER build's REAL worker bundle
(`memberDoorWorker-*.js`) in two node worker threads, the door's and the report's, joined by a channel as the page joins
them (the census reads the door's full answer on its way to the report's worker). Per script, compared field for field
(non-enumerable properties included): the report as the page reads it (head's light report against base's report
projected the same way, with the placements, numeric-column flags and verdict derived from it), the door's answer as the
page reads it and in full, the status alone and with the door's answer, a Use's object program. Both lanes (production,
runtime-on), the 679 line plus the 215 slow-served, one process per script with a cap. Both sides on a FROZEN clock: the
code's answer with no time stop in it (the clock's effect on the answer is e93's, section 7). The nondeterministic
scripts and B, four times each, on the real clock, both sides, both lanes: reported separately.

**Results.** Pending: the census runs on the AFTER build of this head.

## 7. The nondeterministic scripts (the e93 PR)

The first trace's B drew its picture on one run of three. It reproduces on MASTER, in node, with the real bundle: the
door's answer is a function of how fast the machine got through the call, not of the script (a clock scaled k times
slower turns the same script from drawn to refused; a frozen clock gives one answer every run). Two causes:

1. **The translator's 10 s window, swallowed.** `PINE_TRANSLATE_BUDGET_MS` is one window per `translatePine`, read at the
   output loop, the notes pass, the object pass and every Resolver's sampled clock check. A check that trips throws
   `pine:timeout`; inside the object pass a `catch { return null }` takes it for "this step does not translate", drops
   the step, and the object program's loss list then refuses the drawing (`pine:object-removal-lost`). Which steps are
   dropped depends on where the window ran out.
2. **The VM's wall time in the door's probes.** The door runs the program to learn which colour inputs the run reads;
   `WALL_TIME` (5 s) stops a slow probe, and a stopped probe reads as "not read": a different document.

**The fix is not this unit's.** e93 (`fix/pine-e93-deterministic-budgets`, its own engine-versioned PR): a deterministic
step budget per translate call, the wall clock kept only as a last-resort stop that refuses the WHOLE call by name (a
latch every clock read honours, so no `catch` can swallow a part), and the door's runtime clocks held still inside the
door. Its census (master frozen vs today, both lanes; e93 vs frozen) decides it. This unit's census compares base and
head on the same clock, and reports the two scripts #2225 found nondeterministic separately.

## 8. Rails and mutants

Committed corpus scripts and fixtures only. A stand-in worker runs the REAL handler in a FRESH module graph (a real
worker is its own graph), over a structured clone of the real message.

- `memberPane/memberDoorOffThread.test.js`: the door's answer equals the main thread's in every page state an image part
  carries (the test grant, no runtime-pane permission, the starter allowlist empty, the kill list, capability admission
  pending and answered, a library, the known-divergence list committed and synthetic, a synthetic held list), field for
  field with the non-enumerable ones: the FULL answer as it reaches the report's worker, and the page's (without
  `translation`); PasteBox's report: what the page reads is `reportForPage` of the main thread's report, no tree, no
  program, of a read-back only what the page reads, each refusal's text crossing once and put back (a plain clone would
  differ: control); a Use's program equals the main thread's, from the kept report and made again in a worker that no
  longer holds it; THE HUB: in two graphs joined by a channel, the status of each sample's report alone and with the
  door's answer equals the main thread's `editorStatus`, and is small (control: a status without the door's answer
  differs).
- `memberPane/memberDoorService.test.js`: one build per script and state, cancel-on-rebuild, the watchdog, a dead
  worker, the permission latch, the fast control, the page effects of a build.
- `memberDoorPerPaste.test.jsx` (the REAL sheet, both flags on, every door call, report, `translatePine` and
  `editorStatus` counted by thread): a paste makes ONE door build and ONE report, each in its own worker, and NO door
  call, report, translation or status on the main thread; the pane draws, PasteBox shows the report, the status panel
  reads both. The pane while a build runs.
- `pineBoxLightReport.test.jsx` (the REAL PasteBox, rendered with no workers and with stand-in workers): a Use hands the
  sheet the same pick, field for field (an object program, input placements, a numeric column: controls); the verdict
  and the numeric-column field are the same; nothing parsed or judged on the main thread (counted; control: on the main
  thread the counter sees them); the program is made again in a new worker when the one that kept the report has gone,
  before or after the Use asked, never on the page.
- `memberPane/memberDoorBytes.test.js`: bytes per kind of message to the page under a budget, each budget one the old
  messages break (section 5).
- `inspectService.test.js`, `memberDoorWorkerGraph.test.js`: the report service; the worker graph's resolution and its
  registrations (with controls).

Mutants `ci/mutants/u-paste-worker.json` (45): P1-P8 the image and the copy; S1-S13 the service, the pane and
the status panel; W1-W3 the worker resolution and registrations; F1-F2 the faithful transport; I1-I4 the report and the
status off the main thread; H1-H4 the hub (the status without the door's answer, the translation crossing, the workers
never linked, the door not sending its answer); L1-L11 the light report (a tree, a read-back's tree or the program
crossing; PasteBox parsing, judging or placing on the main thread; a Use dropping the program; a worker not remaking a
report; a dead worker's question not asked again; a refusal's text not put back, or crossing whole). Each was checked red locally on this head: mutated, its rail red with its expected text, the exact bytes restored and hash-verified (never `git checkout`).

## 9. Known gaps

- Typing a screen threshold beside a numeric column parses the column on the main thread (`conditionFrom`), as before;
  it is the member's own typing, not the paste.
- A Use's object program is received on the main thread when the member presses Use (the heaviest committed program,
  395 KB; A's: measured with A and B's rows).
- A door answer the page made itself is handed to the report's worker once; if that worker is replaced before the status
  is made, the panel keeps the status of the report alone, marked "checking", until the next answer.
