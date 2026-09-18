# P1 resume — the gate is owed, nothing else is

**Branch `feat/notebook-kill-switch`. Merged tree `6b3a9ece3`. Tree clean. NOTHING PUSHED.**

## Where this stopped, and why

⛔ **The six-shard gate was KILLED BY THE SYSTEM for low memory, twice — before it
ran a single shard.** It produced **no `gate-runs/` directory and no manifest**, so
there is nothing here to misread: a killed gate is INVALID and says nothing about
this branch. The second kill took the *waiter* I armed to watch for a quiet box,
which is how little headroom there was.

⭐ The gate's own pre-flight named the cause before it died, and it was right:

```
⚠ THE BOX IS NOT QUIET — load: BUSY — vitest 1
    vitest pid 11556 ... run src/components/chart/engine/ast/manifest
  Consider waiting, or --max-workers 1.
```

## The cause is external and measured

| owner | processes | memory |
|---|---|---|
| `breadth-dc` (vite preview + esbuild) | **60** | **2,196 MB** |
| other / unattributed | 30 | 1,474 MB |
| **`notebook-k` (this workstream)** | **0** | **0 MB** |

`breadth-dc` leaks a `vite preview` server every few minutes and reaps none:
22 → 24 → 60 processes in ~30 minutes. ⛔ **Not killed by this session** — they may
belong to work in flight (`CLAUDE.md`: the launcher "does not kill the other
process, which may belong to someone else's work"). Reaping them is that
workstream's call, or the owner's.

## Damage check after the kills — CLEAN

The 2026-09-12 incident destroyed a worktree's `node_modules` **and** its `.git`
file under this exact pressure, so this was checked first, not last:

- still a git repo; `HEAD` = `6b3a9ece3`; tree clean
- `.git` file intact
- `app/node_modules` is a **junction into `notebook-flip`** — **368 entries at BOTH
  ends**, target unharmed. ⛔ Never `Remove-Item -Recurse` that link.

## What IS done and committed

| | |
|---|---|
| `0e22baf06` | STEP 2 reproduction — the writer named from a spy log |
| `acd757574` | **Q1 fix 6** — `discardsUnsentWork`, one authority, M1/M2 proved |
| `1524c39a6` | W1 — the append cell's fourth outcome, DEFERRED-BY-GUARD |
| `d76556078` | W2 staged pending; the runner's cp1252 crash fixed |
| `99f544ec6` | investigation doc closed; two classes into CLAUDE.md |
| `b95afa827` | report 07 |
| `ce6c83ac3` | **STEP P0** — `NOTEBOOK_DOOR_GUARD`, M5/M6/M7 proved |
| `6b3a9ece3` | merge of `origin/master` |

Post-merge, scoped: **30 files / 402 tests green**. `grep -c broker_sync api/main.py`
= **10** (≥ 7). Python flag rails: **212 green**.

## What P1 still owes, in order

1. **One full six-shard gate on `6b3a9ece3`**, on a quiet box, nothing touching the
   tree while it runs. Read it BOTH ways — by hand and through `verdict_exit_code`
   — and classify any NEW by direction. ⛔ `--max-workers 1` is available and
   roughly doubles the ~25 min; prefer a quiet box over a longer contended run,
   because a contended shard loses its totals line and costs the run anyway.
2. `python tools/pre_push_guard.py` — it last refused on **recency** (329 s settled
   of 600 s), which is a wait, not a defect. ⛔ Its exit code is not the verdict;
   read its own line.
3. `python tools/land_master_first.py` (`--self-check` PASSES as of this run).
4. Verify: workflow green for the landed SHA → `production` ancestry →
   **your own deploy record's STATUS**, never the newest row, never an uptime you
   did not tie to a named deploy.
5. DEPLOY row: gate manifest, the spy citation, M1/M2, the flag default, and the
   rollback levers **in order** — (1) `railway variable --set
   NOTEBOOK_DOOR_GUARD=full --service web` (which REDEPLOYS; `delete` does NOT),
   verified in-process via `railway ssh`, never `--kv`; (2) the kill switch.
6. 15-minute blip check on the notebook + embed routes, by structured field.

**Then** P2 (guard still `full`), and only on P2 green, P3.

## Two differences from the approved file list, both deliberate

- **`outboxDrain.js` is NOT touched.** The writer was in `useDurableNote`; the
  drain's own sites prove content already (§10.36 sweep, `settleSent` PROVES).
- **`recoverLocalState.js` IS touched.** That is where the extracted authority
  lives, beside `sameAuthoredContent` — the point of fix 6 being an extraction
  rather than a second copy.

⛔ **RESERVED still honoured: fix 6 is committed and NOT pushed. The kill switch is
untouched.**
