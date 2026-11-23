# A saved script's upgrade at chart load builds in the member door's worker (evidence, 2026-11-21)

Branch `feat/pine-upgrade-worker`, stacked on #2254 (`feat/pine-paste-worker`, the member door's worker service).
Part (a) of four member paths found still translating Pine on the page's main thread after #2254 (the others: the
Indicator House copy, the authoring script check, inspect-a-bar).

## The defect

After an engine-version bump, every stale saved Pine document is translated again when a chart loads
(`builder/memberPane/savedScriptUpgrade.js`), so the chart draws today's maths. The translation was the member door
(`memberPaneDefinition`), called on the chart's main thread, one row per idle slot (`requestIdleCallback`), each call
synchronous. An idle slot does not bound a call: a long script froze the tab for the whole translation, at chart load,
on every member's next load after every bump. e93's census measured door calls on served scripts of up to three
minutes on this PC with the clock frozen; today's 10 s translate window cut each call at about 10 s, and the
deterministic budgets of e93 remove that cut. So this path has to leave the main thread before e93 ships.

Sized in production by one read-only aggregate (counts only): a small number of stale script documents today. It
scales with members and with every engine bump.

## The change

- The translator the upgrade loads on demand is now the member door's service (`memberDoorAsync.memberDoorService`,
  #2254): each stale row is a shared keyed build (`{source, id: def_id}`) in the door's worker, one row at a time, in
  order, released once read. A paste made meanwhile goes first (the service builds the newest first) and the row is
  built again once the worker is free. Where there are no workers, the service builds on the thread, one row per idle
  slot, as before. A test that hands in the translator module directly keeps the old path.
- `judgeRetranslation(row, built, threw)`: the verdict on a new translation, wherever the door ran
  (`retranslateRow` calls it). A worker that stopped (it died, it could not answer) is a fact about the check, never
  about the script: the row is drawn as stored and NEVER refused. A refusal is remembered server-side
  (`definition_engine_status`) and every server lane would then withhold the member's script on every device. The
  page's dead-worker answer carries a mark for this (`memberDoorAsync.DOOR_WORKER_STOPPED`), as the door's deadline
  does (`doorTimedOut`).

## Rails and mutants

`builder/memberPane/savedScriptUpgrade.worker.test.js`: a stand-in worker runs the REAL handler in a fresh module graph;
every `memberPaneDefinition` call is counted by where it ran. Stale rows of four scripts (a plain one and three
committed corpus scripts): the upgraded documents equal the main thread's, field for field, non-enumerable properties
included (control: each row is upgraded on the main thread); zero door calls on the main thread; one per row in the
worker; the service holds nothing afterwards (every build released). A worker that dies leaves the row drawn as stored,
not refused, nothing recorded, the landing announced. The mark the upgrade reads is the one the dead worker's answer
carries.

Mutants `ci/mutants/u-upgrade-worker.json`, each checked red locally with its expected text (mutate, the rail red, the
exact bytes restored and hash-verified):
- U1 the upgrade loads the translator itself (back on the main thread);
- U2 a stopped worker's answer judged as a refusal;
- U3 the dead-worker answer without its mark;
- U4 each row's build never released.

The existing upgrade rails (`savedScriptUpgrade.test.js`, `savedScriptUpgrade.prebump.test.jsx`, the
`useUserDefinitions` upgrade and cold-load rails, the legend's upgrade row) run unchanged.
