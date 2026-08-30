# REST backfill — arming runbook (same-day heal for deploy-swap tape gaps)

**What this arms:** `flow_rest_backfill`, which re-reads a gap window from
Massive's REST `/v3/trades` the SAME day. It closes the one gap class nothing
else covers.

**Why it exists — the three heal layers, and the hole between them:**

| layer | covers | state |
|---|---|---|
| `flow_tape_spool` | write-pipeline **freezes** (socket up, writer stalled) — replays today's gaps from spooled frames on consumer start | live (`FLOW_TAPE_SPOOL_ENABLED` / `FLOW_TAPE_REPLAY_ENABLED`, default 1) |
| `flow_gap_autofill` | **deploy swaps**, T+1 from the flat file (16:45 / 21:00 / 08:00 ET) | armed (`FLOW_GAP_AUTOFILL_ENABLED=1`, `DRY_RUN=0`); proven — run 205 healed 4 windows on 8/28 |
| `flow_rest_backfill` | **deploy swaps, same day** | built, wired, **NOT ARMED** — this runbook |

The spool says it in its own header: *"Deploy-swap gaps (socket down) are the one
class this cannot capture — those need Massive's 2nd concurrent connection."*
When the socket is down (every flow-worker deploy) no frames arrive to spool, so
that window survives the replay untouched and waits for the evening's T+1 heal.

**The wiring already exists and is inert.** `flow_tape_spool.replay_gaps` hands
any window with ZERO spooled frames to `flow_rest_backfill.backfill_gap_async`,
which returns `False` while the flag is unset. Today `/api/flow-gap-fill/status`
reports `rest_backfill: {"sent": 0, "reason": "rest_backfill_disabled"}`. That
string is the proof it is reaching the gate rather than never being called.

---

## ✅ Gate 1 — CLEARED 2026-08-30 (and it did not need market hours)

```
GET /api/flow-gap-fill/rest-backfill-probe?window_sec=180000    # read-only
```

```json
{"ok": true, "trades_returned": 3,
 "sample_keys": ["conditions","decimal_size","exchange","id","price",
                 "sequence_number","sip_timestamp","size","ticker"],
 "sample": {"sip_timestamp": 1787931328677098981, "price": 175.79,
            "size": 1, "conditions": [233], "exchange": 302}}
```

Every field `backfill_window` consumes is present — `ticker`, `price`, `size`,
`exchange`, `conditions`, `sip_timestamp`. That is the shape check this gate
exists to perform. **Satisfied; do not re-run it as a blocker.**

### ⭐ The trick: widen the window, don't wait for the open

`probe()` computes `start_ns = now - window_sec * 1e9` and **caps nothing**, so a
window reaching back into the LAST session returns real trades whenever you run
it. The `180000` above is ~50 h, spanning Friday 8/29 from a Sunday.

⚠️ **The DEFAULT `window_sec=300` is a trap outside market hours.** Run bare at
2026-08-29 23:20 ET it returned `{"ok": true, "trades_returned": 0, "sample":
null}` — and `ok: true` there means only "the call did not error". With no
trades the shape check is vacuous: it validated NOTHING. If you ever see that,
widen the window; do not conclude anything from it.

## ⛔ Gate 2 — blocked outside a session, and not by effort

Attempted 2026-08-30 00:47 ET. `GET /api/live/massive/status` returned
`connected: false` with no subscriptions: **the OPRA consumer does not hold a
connection outside market hours, so `_q_subscribed` is EMPTY.** A manual run
with `use_qpool=true` would execute against ZERO contracts, fetch nothing,
insert nothing, and return a clean-looking result proving nothing — the same
vacuous pass the bare probe gave.

`backfill_window` also returns `{"status": "disabled"}` while the flag is unset,
so Gate 2 needs arming FIRST. Arming an unvalidated write path against an empty
contract set is precisely what this runbook exists to prevent.

**Run it during a session**, against a window the tape is known to be COMPLETE
for:

```
POST /api/flow-gap-fill/rest-backfill?start_ns=<...>&end_ns=<...>&use_qpool=true
GET  /api/flow-gap-fill/rest-backfill-status
```

⭐ On a complete window the expected result is `last_trades_fetched > 0` with
`last_inserted: 0` and `last_skipped_dupes > 0` — which proves the path works
AND that `dedup_key` makes overlap harmless, **without adding a single row**.
A second run inserting the same rows again means the key is wrong, not the
window. Keep the span small (2-5 min; `MAX_WINDOW_SEC` is 1800).


## Gate 3 — arm it

```
railway variables --service flow-worker --set FLOW_REST_BACKFILL_ENABLED=1
```

⚠️ `variables --set` auto-redeploys flow-worker, which **bounces the OPRA tape**.
Do it after 16:15 ET, or accept a gap the T+1 heal will repair that evening.

## Verify it actually fires

The next deploy-swap gap should show, in `/api/flow-gap-fill/status`:

```json
"rest_backfill": {"uncovered": 1, "sent": 1, "contracts": <n>, "reason": null}
```

`uncovered > 0` with `sent: 0` and a `reason` is the diagnostic: `qpool_empty`
(the consumer had not resubscribed yet — harmless, T+1 covers it),
`qpool_unavailable` (the consumer module did not import), or
`rest_backfill_disabled` (the flag did not take — check the RUNNING process's
env, not just the service variable).

## Rollback

```
railway variables --service flow-worker --set FLOW_REST_BACKFILL_ENABLED=0
```

Nothing else to undo: the handoff self-gates, the T+1 heal is untouched and
remains the backstop, and every REST-inserted row is dedup-keyed like any other.

## What this does NOT solve

A deploy still drops the socket. This repairs the window minutes later instead
of that evening; it does not prevent the gap. **The only thing that prevents it
is Massive's 2nd concurrent connection** (a vendor/contract question), which
would let a new consumer connect before the old one lets go.

## Owner-decision boundary

The auto-on-reconnect hook lives in `flow_tape_spool.py`, deliberately — the
alternative insertion point is `massive_ws_worker.py`, which is Ravi's file and
needs his ack. If the hook ever needs to move to the consumer's actual reconnect
callback (earlier than the boot replay), that is the conversation to have first.
