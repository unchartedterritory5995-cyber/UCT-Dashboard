# Who would have to adopt the box lock — ⏳ **A LIST, NOT AN ENFORCEMENT**

> ⛔⛔ **READ THIS FIRST, BECAUSE THE LOCK IS EASY TO MISTAKE FOR COVERAGE IT DOES NOT HAVE.**
>
> **`tools/gate_box_lock.py` protects exactly one thing: runs that go through
> `scripts/gate_shards.py`.** Every other entry point on this list starts a gate-shaped run on
> this box and is **completely invisible to the lock** until its owner changes it. Nothing in this
> document has been edited, and nothing here is a request — the owner rules on adoption.
>
> ⭐ What covers the rest *today* is the **sampler**, which catches an intruder after the fact and
> returns `INCONCLUSIVE-CONTENDED`. The lock prevents a collision it can see; the sampler makes
> every collision visible. Owner ruling R1 kept both deliberately: *the lock is in addition, not
> instead.*

## Why this list exists

Every entry below was **derived**, not typed: each candidate file was parsed with `ast`, string
literals inside docstrings were discarded, and only a `"vitest"` literal reaching real **code**
counts. ⚠️ That filter matters — `tools/tests_reaching.py` mentions vitest in prose and is *not*
an entry point; a grep would have listed it. Same rule this repo already applies to its own
literal-hunting sweeps: **code, never prose.**

## The entry points, by path and owner

| path | owner (from its own commit subjects) | what it starts | lock today |
|---|---|---|---|
| `scripts/gate_shards.py` | the shared gate wrapper | six shards of `npx vitest run --shard=i/6` | ✅ **ADOPTED** |
| `app/package.json` → `npm test`, `npm run test:watch` | **unowned — anyone** | `vitest run`, the whole suite | ❌ invisible |
| `app/scripts/run-hub-rails.mjs` (`npm run test:hub`) | **joystick** — lives on the frozen stage-2 branch (`640dcd8d1`), not yet on master | `npx vitest run <hub rail files>` | ❌ invisible |
| `tools/flipc_mutation_gauntlet.py` | **chart / Flip-C** (`debd62658`) | repeated `run_vitest()` | ❌ invisible |
| `tools/flipc_task12_gauntlet.py` | **chart / Flip-C** (`4a32a29e2`) | repeated `run_vitest()` | ❌ invisible |
| `tools/phase_d_gauntlet.py` | **indicator / AST** (`b2c83136a`) | vitest, repeatedly | ❌ invisible |
| `tools/phase_d_task3_gauntlet.py` | **indicator / AST** (`5112939a3`) | vitest, repeatedly | ❌ invisible |
| `tools/q1_door_settle_gauntlet.py` | **Notebook Wave Q1** (`0ecc4f886`) | `npx vitest run <rails>` | ❌ invisible |
| `tools/q1_mutation_gauntlet.py` | **Notebook Wave Q1** (`26ac2683d`) | vitest, repeatedly | ❌ invisible |
| `tools/task8_mutations.py` | **alerts** (`cdbf2fa80`) | `run_vitest()` | ❌ invisible |

⚠️ **A mutation gauntlet is the worst case on this list, not the mildest.** It runs a suite once
per mutation — dozens of vitest invocations back to back — so it holds the box far longer than a
single gate and looks, to the sampler, like a long run of unrelated intruders.

### Observed holding this box during this work — both real, neither hypothetical

- **A six-shard gate in `uct-worktrees/notebook-k`** (pid 36644, and a second at 53928 later). It
  goes through `gate_shards.py`, so it adopts the lock **the moment that worktree pulls master** —
  no change required from that workstream at all.
- **Bare `npx vitest run <file>` from `uct-worktrees/indicator-r0r1`.** Not an entry point in this
  repo's tracked files — a person or agent typing the command. ⛔ **Nothing can make that honour a
  lock**, which is the clearest statement of what advisory means here.

### Not on this list, deliberately

`.github/workflows/*.yml` (`joystick-device.yml`, `optionsflow-guard.yml`, `master-deploy-gate.yml`,
…) run on **GitHub runners, not this box**. They contend for nothing here. They are named only so
nobody adds them later thinking they were missed.

## What each would need to change

The same three lines in every case — there is no per-tool design work:

```python
import sys, pathlib
sys.path.insert(0, str(REPO / "tools"))
import gate_box_lock

try:
    lock = gate_box_lock.acquire("<a run id>", worktree=REPO)
except gate_box_lock.LockHeld as e:
    print(f"the box is held: {e}")     # name the holder, then stop
    raise SystemExit(<your own refusal code>)
try:
    ...the run...
finally:
    gate_box_lock.release()
```

⛔ **`finally`, not "at the end".** A lock only the happy path releases strands the box the first
time anything goes wrong — which is exactly when it matters. `gate_shards.py`'s own wiring is the
worked example, and its rail drives the refusal path (a dirty tree) specifically because that is
the exit everyone forgets.

⚠️ **`npm test` is the awkward one and is worth saying out loud.** It is a package script, not a
Python entry point, so adoption means either a Node shim that reads the same lock file, or a
convention that people run the gate wrapper instead. Both are owner decisions; neither is
proposed here.

## What adoption would NOT buy

⛔ **Still advisory.** Nothing on this box can stop a process from starting. Every adopter is
choosing to ask, and a bypass exists by design (`UCT_SKIP_GATE_BOX_LOCK="<reason>"`, logged) —
though per owner ruling R3 **a bypass never buys a `CLEAR` verdict**: the run is still sampled and
still lands `INCONCLUSIVE-CONTENDED` while the holder is alive.

⛔ **And it would not make the sampler redundant.** Two adopters can still collide with a
non-adopter, a hand-typed `npx vitest`, or a mutation gauntlet mid-sweep. The sampler is the only
thing that sees those, and it is the reason task 4 of this programme was correctly skipped twice.
