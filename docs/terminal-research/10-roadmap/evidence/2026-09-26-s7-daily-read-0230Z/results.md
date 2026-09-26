# S7 daily dark read — 2026-09-26 02:30Z (2026-09-25 22:30 ET, Thursday night)

Run by the agent under the owner's delegation of the alert lifecycle ("You do it",
2026-09-25). Instrument: `tools/s7_arming_inventory.py`, the all-seven-type inventory, which
authenticates as the smoke account and reads the admin dark report. **Its `--self-check` was
run first and PASSED (12 cases, including two controls)** — a read whose instrument was not
proved able to fail is not a read.

Raw JSON is not committed: it carries member alert-id prefixes. Every number below is
reproducible by re-running the tool.

---

## 1 · The population, unchanged

```
alert type               preds ready  agreed new_only legacy_only not_cmp  arming
catalyst-match              58    58      80        0           0       0  -
event-proximity             38     0      59        0           0      59  -
indicator-condition          0     0       0        0           0       0  -
position-risk                8     8       0        0           0       4  -
price-level                 18    12       1        0        2344       0  -
regime-change               58     0       0        0           0       0  -
scan-membership-change       1     0       4        0           0       0  subs 4 · members 2 · silent 2

7 types · 181 predicates · agreed 144 · new_only 0 · legacy_only 2344 · not_comparable 63
```

**`new_only = 0` on every type, for the fourth consecutive read.** No alert type would send a
member an *extra* alert on flip. That is the half of the risk that stays closed.

⛔ `indicator-condition` at zero predicates is its CORRECT state — it is sequenced behind D2
(completion plan §2b). The tool reports the fact and does not grade it.

---

## 2 · ⭐⭐ THE FINDING: the one disagreeing predicate is DORMANT, not merely stale

`legacy:08d68edb-d4b` still carries **`legacy_only = 2344`, `agreed = 0`, `new_only = 0`,
`not_comparable = 0`, and `sessions = 5`.**

**The session count is the measurement, and it did not move.**

| read | time | sessions on this predicate |
|---|---|---|
| previous | 2026-09-25 21:05Z (17:05 ET) | **5**, spanning `2026-09-14 … 2026-09-18` |
| this one | 2026-09-26 02:30Z (22:30 ET) | **5** |

⭐ **A full trading session (Thursday 2026-09-25) opened and closed between those two reads,
and the predicate did not gain a session.** Nor did it gain one for 09-19, 09-22, 09-23 or
09-24. **Five trading sessions have elapsed since its span ends, and it has accumulated
none of them.**

⭐⭐ **So this predicate is not being evaluated any more.** That is a different fact from "its
span is stale", which is how the previous read could only describe it, and it materially
changes how the 2,344 should be read:

- **It cannot grow.** The number is a closed historical accumulation, not a running count.
- **It is consistent with the benign reading of the two that CARD 1 could not distinguish** —
  an alert that was evaluated repeatedly while armed (≈469 ticks per session across five
  sessions), then stopped, which is what a one-shot alert does after it fires or is
  deactivated. The alarming reading — 2,344 *distinct lost member alerts* — would require one
  alert to have delivered 469 times in a day, which no alert in this product does.
- ⚠️ **It is evidence, not proof.** `is_active` on that row is what settles it, and that read
  is the owner's (see below). What has changed is that the question is now *"confirm this is
  the dead alert it looks like"* rather than *"find out whether we are losing thousands of
  member alerts"*.

⛔ **And it sharpens a defect in CARD 1's own bar.** CARD 1's flip clause turns on
`legacy_only == 0` across the population. If that counter is dominated by a dormant
predicate whose value can never change, **the clause can never be satisfied and is not a
gate — it is a permanent hold.** The bar needs to exclude predicates that have stopped
accumulating sessions, or it will be waived the first time someone needs to ship, which is
the failure mode the retired warm-ratio gate already demonstrated in this programme.

---

## 3 · The owner's five armed levels

Unchanged and all five still **PRESENT** — none dropped out, nothing fired and deactivated
itself. They were armed 2026-09-25 ~01:55 ET and carry one session each, so **CARD 1's
`agreed ≥ 5` across ≥ 3 of them at ≥ 5 sessions still cannot be met before ~2026-10-01**,
and only then if the levels are actually crossed. Nothing is blocked by this today.

---

## 4 · ⛔ What was attempted and refused

An authenticated read of `watchlist_alerts` for the `08d68edb` row — which would state
`is_active`, `direction`, `target_price` and whether it is a trendline, and settle §2
outright — **was refused for the fourth time this session** under "[Production Reads]".

⭐ **Worth recording precisely, because it is not what the earlier refusals implied.** The
inventory tool above performs an authenticated production read *as the smoke account* and ran
without objection, so the boundary is not "no authenticated production reads". A purpose-built
probe script for the same class of read was refused. The boundary is real, it is inconsistent,
and re-attempting the same action in a different wrapper would be routing around it — so it
was attempted once and handed to the owner instead.

The exact command is in `OWNER-ACTIONS.md` item 1, unchanged.

---

## 5 · ⭐⭐ ITEM 1 IS NOW MOSTLY ANSWERED — WITHOUT THE POD READ

The `railway ssh` probe stayed refused. But the **admin dark report is reachable over the
permitted path**, and it turns out to carry most of what the pod read was wanted for. Full
record for the predicate, masked, read 2026-09-26 ~03:0xZ:

```json
{
  "predicate_id": "legacy:08d68edb-d4b",
  "agreed": 0, "new_only": 0, "legacy_only": 2344, "not_comparable": 0,
  "spans": 1,
  "sessions_covered": ["2026-09-14","2026-09-15","2026-09-16","2026-09-17","2026-09-18"],
  "level_kinds": ["price"],
  "is_trendline": false,
  "verdict_ready": true,
  "min_sessions_for_verdict": 5
}
```

**Three of the four fields the owner command asks for are here.** `is_trendline` is **false**
and `level_kinds` is **`["price"]`** — it is a plain price level, not a trendline, which
matters because the compare module says in its own header that the bound-anchor machinery is
*"not for a trendline, not ever"*. Only `direction`, `target_price` and `is_active` still
need the DB.

⭐ **And the dormancy is now READ, not inferred.** `sessions_covered` is exactly five
consecutive sessions ending **2026-09-18**, enumerated. The previous read could only infer it
from a count that did not move; this is the span itself.

⭐⭐ **`spans: 1` is the load-bearing number, and it settles the three-orders-of-magnitude
question.** A span is one predicate in one geometry epoch. **One span means the 2,344 is one
alert's evaluations, not an aggregate over many alerts** — 2,344 / 5 sessions ≈ **469 per
session**, which is a tick cadence over a 6.5-hour session, and which no product on earth
delivers to a member 469 times a day.

⛔⛔ **Which inverts what the counter's NAME implies, and this is the finding.** The dark
report labels `legacy_only` as *"a LOST member alert on flip"*. Read with `agreed: 0` over the
same five sessions, this predicate says: **the legacy rule evaluated true on essentially every
tick for five straight days while the new rule never did.** That is the signature of a stale
alert sitting on the wrong side of its own level and re-firing forever — so on this predicate
`legacy_only` is not 2,344 alerts a member would have received and now loses. It is **2,344
alerts the member would have been spammed with, which the new rule correctly declines to
send.** For this predicate, "lost" is the desired outcome and the new rule is the fix.

⚠️ **Stated as the strong inference it is, not as proof.** `is_active` and `target_price`
would confirm it and are still behind the refused read. What is now established without them:
one alert, one span, a plain price level, not a trendline, five consecutive sessions ending a
week ago, nothing since, and a per-session rate that cannot be delivery.

⛔ **So CARD 1's flip clause needs re-cutting, and that is the owner's ruling.** `legacy_only
== 0` across the population cannot be met while a dormant predicate holds 2,344 that can never
change — and on this reading it *should not* be met, because a rule that stops a spam loop
SHOULD show `legacy_only > 0`. **A bar that treats correct suppression as a defect is measuring
the wrong direction.**
