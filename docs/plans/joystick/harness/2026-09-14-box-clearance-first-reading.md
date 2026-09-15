# Box clearance, 2026-09-14 22:29–22:31 — **INCONCLUSIVE-CONTENDED**

The first real reading from `tools/gate_box_sampler.py`, and the reason the two
`ThemeTrackerPage.chartmount` re-measurements in the harness-hardening brief were **not run**.

> `VERDICT=INCONCLUSIVE-CONTENDED exit=3 samples=7 min_free_gb=9.43 first_seen=2026-09-14T22:29:52 pid=7668 kind=vitest intruders=4`

## The seven samples

| # | time | free | foreign |
|---|---|---|---|
| 1 | 22:29:10 | 11.71 GB | — |
| 2 | 22:29:32 | 9.43 GB | — |
| 3 | 22:29:52 | 11.92 GB | **vitest 7668, vitest 34268** |
| 4 | 22:30:13 | 12.19 GB | — |
| 5 | 22:30:33 | 12.10 GB | — |
| 6 | 22:30:54 | 12.41 GB | **vitest 24444, vitest 51072** |
| 7 | 22:31:15 | 11.83 GB | — |

## ⭐ The first and last samples are both CLEAN

That is the whole finding. An endpoint check — the method that invalidated two settling runs on
this same day — takes sample 1 and sample 7, sees nothing in either, and reports **CLEAR**. The
contention is visible *only* because the interval was sampled, and it appeared twice inside two
minutes.

This is the 2026-09-14 failure reproducing itself against the instrument built to catch it, on
that instrument's first real use. It was not staged.

## Who it was

```
pid 7668   "C:\Program Files\nodejs\node.exe" node_modules/vitest/vitest.mjs run
           src/components/chart/engine/ast/bothLanesAgreeOnFacts.test.js
pid 34268  ...\uct-worktrees\indicator-r0r1\app\node_modules\vitest\dist\workers\forks.js
```

⭐ **Named, not counted.** The command line says which worktree (`indicator-r0r1`), which test file,
and that it is a short single-file run rather than a six-shard gate — three facts a count of
"4 intruders" would have withheld, and all three are what an operator needs to decide whether to
wait or to go and ask. This probe's own history is of *counting things that were not there*.

⚠️ **No inference about what that workstream is doing.** A single-file vitest run that reappears
every ~60s is consistent with a watch loop, a retry loop, or two unrelated runs; the samples
cannot distinguish them and this record does not guess.

## Consequence — task 4 skipped, and why that is the correct outcome

The brief scoped the `ThemeTrackerPage.chartmount` re-measurement as *"only if the box is clear
under the new sampler, otherwise skip and say so."* It is not clear. **The two entries were not
re-measured, nothing was removed, re-banked, or changed, and the baseline count stays at 10.**

⛔ **Running them anyway would have produced exactly the artefact this whole procedure exists to
exclude:** those two entries are already classified *load-sensitive (~4 s)* in
`docs/breadth/gates.md`, so a timing measurement taken beside somebody else's vitest workers
cannot separate the hypothesis from the contamination. A contaminated number banked as a
measurement is worse than no number — #9's five runs are already on record as the case where a
"load" label turned out to predict nothing.

⭐ And the free-memory column is *not* the reason. 9.43 GB is comfortably above the 4.5 GB floor;
this is `INCONCLUSIVE-CONTENDED`, never `INCONCLUSIVE-RESOURCE`. The sampler orders contention
above resource deliberately, so a low reading taken during someone else's run cannot be reported
as a memory problem and send the next reader to tune the wrong thing.

## What settles it

Re-run when a `--watch` over an interval at least as long as the intended measurement returns
`VERDICT=CLEAR`:

```sh
python tools/gate_box_sampler.py --watch 600 --interval 20
# then, only on CLEAR, with the sampler wrapping the run itself:
python tools/gate_box_sampler.py --watch-pid <the vitest pid> --trail runs.jsonl
```

⛔ **Wrap the run, do not bracket it.** `--watch-pid` samples for the life of the measured process,
which is the correction this instrument exists to make.

Raw samples: `clearance.jsonl` (scratchpad, not committed — the table above is the record).
