# ⛔ D3's REMAINING BLOCKER — the append drain stalls after its first 409

**Status: precisely characterised, NOT resolved. This is the last thing between
the programme and D3, and it is a specific testable hypothesis rather than an
INCONCLUSIVE.**

Evidence: `evidence/20260919T081701-p3-append-door-restored-guard-unknown-only/`

## What the wire shows, in order

```
POST /                      → 200    create
POST /<id>/opened           → 200
PUT  /<id>                  → 200    baseline save
POST /<id>/opened           → 200
PUT  /<id>+SENT             → None   ×3   offline — correct
POST /<id>/embeds           → 200    ⭐ the append door FIRES AND SUCCEEDS
PUT  /<id>+SENT             → 409    the embed moved the revision; entry is stale
POST /<id>/opened           → 200
POST /<id>/images           → 200
PUT  /<id>                  → 200    (no +SENT — a different write)
```

Then nothing. **No second `+SENT` attempt for 240 s.**

## Why that is surprising

`useOutboxDrain.js:32` — `RETRY_INTERVAL_MS = 60000`, and `:288` re-drains on
that interval whenever `pendingRef.current > 0`. Four retries should have fired
inside the window. **One 409, then silence.**

And the durable store agrees that nothing moved:

```
store trail (queued, dirty, base, sentence-in-record):
  [(1, True, '72+00:00', True)]        ← ONE entry, for the whole 240 s
```

A GREEN metadata cell shows a transition — `[(1,True,…), (0,False,…)]`. This shows
none. The entry was neither sent, nor rebased, nor forked.

## What SHOULD have happened

`outboxDrain.js` has a path for exactly this. On a 409 where the ring cannot vouch
for the revision, it asks the DIFF (`classifyServerChange`): an embed is an
`APPEND_ONLY` change, so `mergeAppends` should put the server's appended node back
onto the queued body and resend. That path requires
`mine?.serverNote && isUsableBaseline(mine.serverUpdatedAt)`.

## The hypotheses, in the order worth testing

1. **The pre-send server read returned nothing** (`mine.serverNote` null), so both
   the ring path and the diff path were skipped and the entry fell through to
   `KEPT` — words preserved, never delivered.
2. **`pendingRef.current` is 0** despite the entry being queued, so the 60 s
   retry never fires. That would make the stall permanent, not slow.
3. **The leader lock is not held by this tab**, so no drain runs at all. The
   probe read `locksHeldPending: '1/0'` at setup time; it was not re-read during
   the wait.

⭐ These are distinguishable by ONE instrumented run: log the drain's own
`results[]` outcome (`SENT` / `KEPT` / forked) and `pendingRef.current` on each
interval tick. The rig currently reads the STORE and the WIRE, and both are
consistent with all three hypotheses — which is exactly why reading harder will
not settle it.

## ⛔ What this is NOT

- **Not a loss.** `RED = 0`. The member's words are in the durable copy and in
  the queue the entire time. The tool's own words: *"Not 'lost'; not yet
  delivered."*
- **Not the guard.** `DEFERRED-BY-GUARD = 0` — the door was genuinely open.
- **Not fix 6, and not the provenance split.** Both are upstream of the send;
  this is the drain's 409 handling.
- **Not visible before now.** Every previous append run had the guard `full`, so
  the door deferred and no drain ever started. Opening the door is what made this
  measurable — which is what P3 was for.

## Why the rig cannot just wait longer

The 240 s ceiling was already raised from 120 s this session. If hypothesis 2 or 3
is right the entry never drains at all, and a larger ceiling buys a longer wait
for the same answer. ⛔ **Do not close this by raising the budget again** — that
is the third time today that lever would have hidden a finding instead of
answering it.
