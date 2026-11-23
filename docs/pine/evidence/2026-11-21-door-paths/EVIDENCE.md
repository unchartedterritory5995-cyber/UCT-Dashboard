# Indicator House's copy and inspect-a-bar build in the member door's worker (evidence, 2026-11-21)

Branch `feat/pine-door-paths`, stacked on the saved-script upgrade (`feat/pine-upgrade-worker`) and #2254. Parts (b)
and (d) of the four member paths found still translating Pine on the page's main thread after #2254; (a) is the
saved-script upgrade, (c) the authoring script check (another session).

## The defect

- **Indicator House's copy** (`IndicatorHouseTab.buildPineCopy`): pressing a Pine entry's add ran the member door
  (`memberPaneDefinition`) on the page's main thread, the whole translation in one task.
- **Inspect-a-bar** (`builder/inspect/inspectDoors.build`, read by `barInspection.inspectScript`): the script and every
  probe copy of it (one per batch of variables, and one per variable a batch could not plot) went through the door
  synchronously on the main thread.

On a long script each call holds the tab for the whole translation; e93's deterministic budgets remove the 10 s cut
that bounds it today, so these paths leave the main thread first.

## The change

- `memberDoorAsync.doorBuildOnce(args, service)`: one build of the door's service, asked once, as a promise of what
  lands; the subscription is released once it has. A build another subscriber reads goes on for it (a release stops a
  build only when its last reader leaves).
- `buildPineCopy` asks the door's worker for the entry's build; a door that threw is the copy's own "could not be
  prepared" answer, as a missing build always was.
- `inspectDoors.build` is a promise of the door's answer (the script itself shares the pane's build: one key), and
  `inspectScript` awaits it. A door that threw rejects, as the call did.
- Without workers the service builds on the thread, as before.

## Rails and mutants

`builder/memberPane/doorPaths.worker.test.js`: a stand-in worker runs the REAL handler in a fresh module graph; every
door call is counted by where it ran; the page's modules are imported after the worker's graph is made (the paths
import the service on demand). For two committed scripts: the copy equals the main thread's field for field (control:
on the main thread the counter sees the build); the door's answer (less its translation, which the page never reads)
and the whole inspection equal the main thread's; no door call on the main thread; the service holds nothing after.
The existing rails (`IndicatorHouseTab*.test.jsx`, `inspectDoors.test.jsx`, `inspectProof.test.js`,
`InspectBar.test.jsx`) pass, the two that called `build` synchronously now awaiting it.

Mutants `ci/mutants/u-door-paths.json`, each checked red locally with its expected text, exact bytes restored and
hash-verified: B1 the copy on the main thread again; D1 inspect-a-bar on the main thread again; O1 a one-shot build
never released.
