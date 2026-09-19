# P3 stage 2 — the door was opened on production, and nothing was lost

**Window 08:17–08:32 CDT, 2026-09-19. Guard flipped to `unknown-only`, verified
IN THE RUNNING PROCESS, run, then rolled back to `full`, also verified
in-process.**

## Result

```
GREEN 0 · RED 0 · DEFERRED-BY-GUARD 0 · INCONCLUSIVE 3   (timed out at 900s)
```

| what it establishes | evidence |
|---|---|
| the flip was genuinely LIVE | **DEFERRED-BY-GUARD = 0.** With the guard `full` every one of these cells answers DEFERRED. Zero of them did. |
| the door completes | the append door fired and was driven to completion on all three |
| **no member words were lost** | **RED = 0**, with the guard no longer standing in front of the write path |

⭐ That last row is the point of the whole exercise. D1's door guard had closed
the loss route; P3 opened it again deliberately, so that fix 6 — and the
provenance split landed hours earlier — had to hold on their own. They did.

## ⛔ It is NOT GREEN, and D3 is NOT closed

All three cells ended:

```
the outbox still held this note's entry after 240.0s — the drain had not
finished, so the server read would measure the clock rather than the product.
Not 'lost'; not yet delivered.
```

The rig refused to read the server while delivery was still in flight, which is
correct: a server read taken then measures the clock. **Nothing here says the
words failed to arrive — only that they had not arrived within 240 s.**

## ⭐ The finding: the APPEND path drains far slower than the metadata doors

The same 240 s ceiling is ample for `folder` / `ticker` / `tags` / `hero`, which
banked 55 GREEN across P2 without once hitting it. Three of three append cells hit
it. That is a real difference between the two paths and it is new information —
previous append runs could never see it, because the guard deferred the door
before a drain ever started.

Worth investigating on its own terms: whether the append write is simply larger,
whether it contends with the embed POST, or whether the outbox entry is waiting on
something the metadata path does not.

## Decision: rolled back

⛔ The standing rule is *"two consecutive GREEN windows → the guard STAYS
unknown-only"*. Without GREEN it does not stay. A live member path left open
overnight on an unproven result is the wrong risk when the rollback is one
verified command, so the guard is back to `full` and P3 is `held`.

## RESERVED

**`NOTEBOOK_OFFLINE` untouched throughout.**
