# Wave L Slice 2 — measured interaction counts and blocker resolution

Actual counts from running the code, not adjectives.

## The two measured blockers, before and after

Both were found by probing the real modules, not by reading them.

| Probe | Before | After |
|---|---|---|
| `QUICK_THOUGHT_BLOCKERS` | `["a source URL"]` — the intended highest-frequency workflow was **impossible** | `[]` |
| `PALETTE_NO_CONTEXT` | `["a destination"]` with **nothing able to resolve it** — a global command that could never complete | Save disabled before picking, **enabled after** — the picker resolves it |

## Meaningful actions to a saved state

"Meaningful action" = something the member does on purpose: invoking, typing or
pasting, choosing a destination, pressing Save. Focus moves and re-renders are
not counted.

| Flow | Door | Actions | Destination | Re-entry needed? |
|---|---|---|---|---|
| **A** current-note quick thought | hotkey / palette | **3** — invoke · type · Save | prefilled, visible | no |
| **B** ticker research thought | research context | **3** — invoke · type · Save | "NVDA Research", changeable | no |
| **C** global quick thought | palette, no context | **4** — invoke · type · pick · Save | picker over the member's own recents | no |
| **E** external passage | source door | **3** — invoke · paste · Save | prefilled from door | no |
| **F** duplicate capture | any | **3**, feedback differs ("Already saved to…") | prefilled | no |
| **G** rights refusal recovery | source door | **4** — invoke · paste · Save · choose "Save the link only" | prefilled | **no — nothing is retyped** |

⭐ **C is the only flow that costs a fourth action, and it is the only one that
earns it:** with no context there is genuinely nowhere obvious to put a thought,
so the product asks rather than guessing. Every other flow keeps the destination
prefilled and visible.

⛔ **G matters more than its count.** A rights refusal preserves the passage, the
note, the link and the destination — the fourth action is a *choice*, not a
retype. The dialog does not close before durable success, proven across network
failure, server error, stale destination and validation refusal.

## Internal UCT capture (kind C)

Unchanged by Wave L, and deliberately so. Its existing doors keep their existing
flow. G-040's remaining surfaces were **descoped** (owner ruling 2026-09-08) —
see `future-internal-capture-expansion.md`.

## Phone-width certification — DEFERRED, with the precondition recorded

**Not run, and deliberately not run.** At the time Slice 2's implementation
completed, the machine had **~2.2 GB free of 31.8 GB**, with another workstream
(`uct-worktrees/mobile-impl`) holding 3.1 GB and 2.7 GB in vitest workers, and
30 node/python processes live.

⛔ **A browser audit under memory starvation is exactly the run that produces a
vacuous pass** — this program has already recorded three distinct ways
`tools/mobile_audit.py` can pass while auditing nothing. Running it to tick a box
would have produced evidence worth less than no evidence.

**Precondition for the deferred run:** sufficient free memory that the audit's
browser workers are not competing with another workstream's suite, and the
hardened anti-vacuity checks confirming real routes were audited (`screens` and
finding counts consistent with a real page, not a 404).

Three background watchers of mine were killed by the OS for memory during this
period. Their targets had already completed, so no result was lost — recorded
because "a task was killed" and "the thing it watched failed" are different
facts, and only the second would be a product problem.
