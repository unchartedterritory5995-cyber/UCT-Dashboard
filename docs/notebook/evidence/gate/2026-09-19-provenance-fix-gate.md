# Six-shard gate for the fix-6 provenance split — classified by DIRECTION

**`VERDICT=NEW_FAILURES exit=1 new=24`**, 1,607 test files, `reconciles=true`.

⛔ **Read the direction before reading the count.** The rule is "no NEW failures
relative to a measured baseline", and the baseline is
`1216958ed`, **measured 2026-09-14**.

## The classification

| | |
|---|---|
| this branch's ENTIRE `app/src` diff | **3 files**, all under `pages/journal-2-0/lib/offline/` |
| those 3 files under `components/chart` | **0** |
| the 24 new failures, by path | **24 of 24 under `components/chart`** |
| failures under `journal-2-0` | **0** |
| chart commits landed on master since the baseline | **103** |

A branch that touches no chart file cannot have broken 24 chart tests. The
baseline predates 103 chart commits; these belong to that workstream to
re-baseline, and are recorded here rather than silently absorbed.

## ⭐ The gate also caught one that WAS mine, and I had dismissed it

The previous run of this gate reported **25**. The 25th was:

```
src/__tests__/sourcesAreText.test.js > every JS/JSX source under app/src is TEXT
  > contains no NUL or other C0 control byte
```

That was **mine** — my first attempt at the fix wrote two `0x00` bytes into a
template literal where spaces belonged, making the file BINARY to git and ripgrep.
⚰️ I waved it away as another workstream's noise **because 24 of the 25 were**,
which is precisely how a real signal hides inside a stale baseline. It is fixed,
and this run reports 24 with that entry gone.

## What the change itself is verified by

134 passed across `fix6KeepsTyping`, `selfForkDoors`, `q1AppendWriterCensus`, the
47-case `offlineWordsSurvive` property suite, `outboxDrain`,
`doorDefersWhileUnsent`, `recoverLocalState` and `sourcesAreText`.
Mutation-proved: gutting the containment check reds the editor test (exit 1);
restored is exit 0.

⛔ C5 — the master deploy gate on the landed SHA — remains the merged-reality
check, and is not waived by anything above.
