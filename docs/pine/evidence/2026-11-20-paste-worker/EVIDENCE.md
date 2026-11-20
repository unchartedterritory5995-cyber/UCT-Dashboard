# The member door builds a paste in a Web Worker, once (evidence, 2026-11-20)

Branch `feat/pine-paste-worker`, cut from master `4dae9f9e06` with #2225 (`fix/pine-door-deadline`, the one-window door
deadline, train e91) merged in, because the deadline now runs inside the worker. The licence-held scripts this unit
measured are never committed: the rails use committed corpus scripts and fixtures, and the per-script rows stay in
private evidence (the coordinator has them). This page carries the method, the aggregates and the verdicts.

## 1. Answer first

- **The defect.** A pasted script's build (`memberPaneDefinition`, the member door) ran SYNCHRONOUSLY on the page's
  main thread, and in production it ran TWICE per paste: in `MemberPane.jsx` (a `useMemo`) and again in the editor's
  status panel (`PineEditorStatus.jsx::usePineEditorStatus` -> `paneFor`, another `useMemo`; production bakes
  `VITE_PINE_EDITOR_STATUS=1`, read from `railway variables --kv` on `web` and `web-front`). On the scripts the door
  serves, one call takes 0.57 s at the median, 4.3 s at p90, 52 s at p99 and up to 157 s (#2225's census, dev PC). Every
  one of those seconds, twice, was a frozen tab. A deadline can only END a call; it cannot shorten one.
- **The fix.** The door runs in a Web Worker (`memberPane/memberDoorWorker.js`), and a paste builds it ONCE: one shared,
  keyed build per script and page state (`memberPane/memberDoorAsync.js`), read by both the pane and the status panel.
  The worker runs the door unchanged, over an image of exactly the page state it reads (section 2). A newer build
  stops the running one. #2225's one-window deadline runs inside the worker, and a watchdog at that deadline plus 30 s
  stops a silent worker and refuses the script by name. A worker that dies refuses the script by name. While a build
  runs, the pane keeps the picture it drew, says "Checking your script...", and its Add waits for the build on screen.
- **Byte-identical.** TBD (section 4).
- **The main thread.** TBD (section 5, patrick-54's trace).
- **Not in this unit.** PasteBox's own report (`PineBox.jsx::inspectSource`, one `translatePine` of the paste in a
  250 ms debounce) is a third main-thread translation on the paste path. It is not the door, and it is not small to move:
  its report holds the translator's working state (functions) and feeds about fifteen PineBox memos. TBD (section 6).
- **Nondeterminism.** TBD (section 7).

## 2. The mechanism

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

Everything else in the door's graph (171 modules, walked with `tools/pine_runtime_closure.mjs`'s walker) is a constant, a
registration every graph makes when it loads, or a cache of a pure computation; the build flags are baked into the
worker's bundle by the same build. To make that graph worker-safe, `buildDefinition` (from `BuilderSheet.jsx`) and
`evaluateFormula` / `canSaveFormula` (from `FormulaField.jsx`) moved verbatim into pure modules (`builder/buildDefinition.js`,
`builder/evaluateFormula.js`), re-exported from their old homes: the door's graph went from 838 modules (React, the chart,
every builder panel) to 171, with no JSX and no CSS.

**What the build does to the page is done on the page.** The door's consults of the runtime lists have effects: a re-read
of the lists, an admission ask, and the "still being checked" mark the pane's first-paste rule reads. The worker records
each consult (`runtimeKill.recordRuntimeConsults`), and the page makes the same consults, in order, when the answer lands
(`replayRuntimeConsults`), before anyone reads it. A door that asked for the runtime lane to be warmed
(`runtimeAsync.warmRuntimeLane`, counted in the worker) has it warmed by the page. The worker also reports whether a
consult left the script "still being checked" right after the build, in the build's own state (`consultPending`), which is
what the pane's first-paste rule read on the main thread before.

**What crosses.** The door's answer, as plain data (`memberDoorWorkerCore.plainAnswerOf`): every own enumerable field
that is not a function, at every depth; a Map and a Set as themselves; a class instance as its own enumerable fields (an
error keeps its name and message); ONE copy of an object reached twice, so `a === b` in the answer is `a === b` on the
page (the status panel finds a row's output by its tree's identity). That includes the translation, which the status
panel reads.

**One build, shared.** A consumer subscribes to `{source, id, name}` (`id` defaults as the door defaults it,
`MEMBER_PANE_DEF_PREFIX`, so the pane's `{source, id}` and the status panel's `{source}` are one request, as they are
one build). A subscriber arriving while its build runs waits for it; one arriving after it landed, in the same state
(`memberDoorStateVersion`: every image part's revision and the build flags), reads it at once; one arriving in a newer
state starts a new build that every subscriber of that script reads. The answer is held only while someone is
subscribed. One build runs at a time, the newest first; a stopped script that is still wanted is built again once the
worker is free.

**Never a silent hang, never a guess.**
- the door's own deadline (#2225, 5 minutes, one window per call) refuses by name (`pine:timeout`) inside the worker;
- the watchdog (`MEMBER_DOOR_WATCHDOG_MS` = the deadline + 30 s): terminated, refused with the deadline's own answer;
- a worker that dies (an uncaught error, an answer it cannot post or the page cannot read, one that will not start, a
  job it cannot be sent): terminated, refused by name (`pine:door-worker`, the status panel's "Engine fault" family);
- a door that threw: the pane refuses by name (`pine:door-failed`; on the main thread this crashed the pane), and the
  status panel keeps its own wording (`import:internal-error`).
- With no `Worker` (tests, a non-browser host) the build runs on the thread, as before, still once per script and state.

## 3. Why not the existing runtime worker bundle

The door's graph imports `runtime/runtimeAsync.js`, which spawns `runtimeWorker.js`: putting the door into that bundle
makes it refer to itself. And it would grow the worker every runtime chart spawns by about 1.6 MB of source (52 modules
the runtime worker does not hold), parsed on every chart's first runtime run. So the door has its own entry, spawned
only when a member pastes, following the host and runtime workers' pattern: a pure handler (`memberDoorWorkerCore.js`)
and an entry that only wires it to `self` (`memberDoorWorker.js`).

## 4. Census: the worker's answer is the main thread's

TBD

## 5. The main thread: the trace

TBD

## 6. PasteBox's report translation (measured, not moved)

TBD

## 7. The two nondeterministic scripts

TBD

## 8. Rails and mutants

TBD
