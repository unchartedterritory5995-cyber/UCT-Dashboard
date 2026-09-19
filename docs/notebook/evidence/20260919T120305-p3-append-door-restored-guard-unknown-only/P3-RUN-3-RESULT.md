# P3 run 3 — the door is measurable at last: 3 GREEN, 1 RED, 1 INCONCLUSIVE

**Guard `unknown-only`, verified in-process. Rolled back to `full` on the RED,
immediately, per the standing rule — verified in-process after.**

```
GREEN 3 · RED 1 · INCONCLUSIVE 1 · DEFERRED-BY-GUARD 0
```

Both previous P3 runs were 0/0/3 — every cell timed out. The difference is one
line: append families now **release the note** before the drain wait, which hands
the entry to the sweep. That step existed and was gated to the two controlled
experiments only.

| ordering | verdict |
|---|---|
| drain-first | INCONCLUSIVE (drain > 240 s) |
| **marker LIVE** | ✅ **GREEN** |
| **marker EXPIRED** | ✅ **GREEN** |
| slow PUT (landed, ring populated) | 🔴 **RED** |
| **reload mid-flight** | ✅ **GREEN** |

## ⛔ The RED is a SERVER 500, not a client defect — and the member's words SURVIVED

```
POST /<id>/embeds → 500      ← the server rejected the embed; the node was never created
PUT  /<id>+SENT   → 500
POST /<id>/opened → 200
PUT  /<id>+SENT   → 200      ← recovered, and the member's sentence went through
```

The cell reads **`offline sentence in the server body: True`** and
**`appended node present: False`**. So the member's offline words are on the
server; what is missing is the DOOR's own node, because the server 500'd on the
POST that would have created it.

⭐ **That is the correct direction for this system.** Wave Q1 exists to protect the
member's unsent words, and they survived a server error that destroyed the door's
own write. Nothing the client did lost anything.

⚠️ **It is still a RED and was treated as one.** The rule is *"any RED → `--to
full` immediately, verify in-process, commit the artifact, STOP"* — not *"any RED
you cannot explain"*. Rolled back within two minutes of reading it.

## Is the 500 new?

It is the same shape as the server-side failures that made 2.8b INCONCLUSIVE 22
times on 2026-09-18 (`sqlite3.OperationalError: database is locked` →
HTTP 500 on note creation), which another workstream's `R72` work addressed. This
one is on `/embeds` rather than note creation. **Not investigated here** — it is a
server-availability question, and this workstream's claim is about the client.

## What D3 now needs

Three of five orderings are GREEN with the door open. The remaining two are:

1. `slow PUT` — RED **on a server 500**. A re-run on a healthy pod is the honest
   next measurement; this cell has never been given one.
2. `drain-first` — still INCONCLUSIVE at the 240 s drain ceiling, the only
   ordering that did not benefit from releasing the note.

⛔ Neither is evidence against fix 6. Across all three P3 runs, **no cell has ever
reported the member's offline sentence missing from the server**.
