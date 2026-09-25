# S7 daily dark read — 2026-09-25 21:05Z (17:05 ET)

Run by the agent under the owner's delegation of the alert lifecycle ("You do it",
2026-09-25), per `RESUME-HERE.md` §9. Both reads are the admin dark report via
`dark_dump.py`, as the smoke account, ids masked. Raw JSON is not committed (it carries
member alert-id prefixes); every number below is reproducible by re-running §9's two
commands.

---

## 1 · price-level — `predicate_count = 18`

### The owner's five armed levels (what CARD 1's bar is measured on)

All five are **PRESENT** — none dropped out, nothing fired and deactivated itself:

| alert id | sessions | agreed | new_only | legacy_only | ready | kind |
|---|---|---|---|---|---|---|
| `72b7ff28` | 1 | 0 | 0 | 0 | false | price |
| `a6e2b755` | 1 | 0 | 0 | 0 | false | price |
| `c21681ca` | 1 | 0 | 0 | 0 | false | price |
| `b08c9841` | 1 | 0 | 0 | 0 | false | price |
| `01b5b35b` | 1 | 0 | 0 | 0 | false | price |

**CARD 1's bar is NOT met and cannot be before ~2026-10-01.** It needs `agreed ≥ 5`
across ≥ 3 of these with `≥ 5 sessions`; they were armed 2026-09-25 ~01:55 ET, so they
carry one session. Five trading sessions from 09-25 lands on **2026-10-01** at the
earliest, and only if the levels are actually crossed — `agreed` counts ticks where both
rules fired, so an uncrossed level accumulates sessions without accumulating `agreed`.

### ⛔ THE POPULATION'S `legacy_only` IS NOT ZERO — 2,344, ALL ON ONE PREDICATE

Every recorded dark read in this program has reported `agreed` and `new_only` and **has
not mentioned `legacy_only` at all** (see §3's 09-25 row: *"13 predicates, 12 ready,
agreed 1, new_only 0"*). It is not zero, and it is the counter CARD 1's flip clause turns
on:

| | value |
|---|---|
| predicate | **`legacy:08d68edb-d4b`** — the ONLY one of the 18 carrying any |
| `legacy_only` | **2,344** (≈ **469 per session**) |
| `agreed` | **0** — the dark rule never fired on this predicate, not once |
| `new_only` / `not_comparable` | 0 / 0 |
| sessions | `2026-09-14 … 2026-09-18` — **the span stopped advancing a week ago** |
| `verdict_ready` | **true** (5 sessions reached) |
| kind / trendline | `price` / false — so it is NOT excused by the trendline carve-out |

Population totals: 18 predicates, 12 ready, `agreed` 1 (on `f0d66360`, 10 sessions),
`new_only` 0, `legacy_only` 2,344, `not_comparable` 0. The other 17 predicates are clean
zeros, the owner's five included.

**What the counter means, read from the source rather than assumed**
(`api/services/alert_taxonomy/price_level_compare.py:51-56`):

> `legacy_only` — the legacy twin fired, the dark side did not → **a LOST member alert on
> flip**

and the grain is a **tick** (*"both sides fired on the same tick"*), not a delivered
alert. So 2,344 is 2,344 *ticks*, and it is **not** established that it is 2,344 lost
deliveries — the legacy path is one-shot (`watchlist_alert_service._trigger_alert` sets
`is_active = 0` before delivery), so one alert cannot deliver 469 times in a session.
⛔ **Both readings are still open and they differ by three orders of magnitude.** What is
established is the direction: on this predicate the dark rule fired **zero** times while
the legacy rule fired on 2,344 ticks across five sessions.

**All 18 predicate ids carry the `legacy:` prefix**, so this is a CP3 read-only
*projection of a real `watchlist_alerts` row*, not a harness-owned synthetic twin (CP2's
population). That is what makes it worth resolving rather than dismissing.

### ⛔ The one probe that would settle it was REFUSED, and is the owner's to run

Whose alert `08d68edb` is, what level and direction it carries, and whether it is still
active, needs a read of `auth.db`'s alert tables on the pod. The session's classifier
refused it (*"[Production Reads]"*). It is **read-only** and masks the user id. The exact
command is in §5's CARD 1 row for the owner to run.

Until it is answered, **CARD 1's "legacy_only 0" clause is unevaluated, not satisfied** —
and nothing is blocked today, because the bar cannot be met before ~10-01 anyway.

---

## 2 · scan-membership-change — `predicate_count = 1`, and the reason is now MEASURED

| | value |
|---|---|
| predicate | `legacy:<uid>:sha256:b01b7707…` (the smoke account's 09-21 screen sub) |
| status | `OBSERVED`, `observed = 4` |
| sessions | `2026-09-22, 09-23, 09-24, 09-25` — **today's sweep did run and did compare** |
| agreed / new_only / legacy_only / not_comparable | **4 / 0 / 0 / 0** |
| drift | `new_only` 0, `legacy_only` 0 |
| `min_sessions_for_verdict` | 5 → `verdict_ready: false` |
| heartbeat | 12 ticks, last `2026-09-25` |

**The 2026-09-26 tick reaches the 5-session floor**, exactly as CARD 2 projected.

### ⛔ But the owner's three screens are NOT predicates, and will not become predicates by waiting

CARD 2's plan says the owner's three subscriptions (26wk HV, Above 50 on volume, Oops
Reversal, made 2026-09-25 ~01:55 ET) would be *"projected by tonight's sweep"*. Today's
sweep ran — the smoke predicate's `sessions_covered` proves it — and
`predicate_count` is **still 1**, with `definitions` still listing one hash.

The report's own `blind_spots` field names the reason and admits it was unmeasured:

> *"HOW MANY MEMBERS THIS ABSORPTION HAS IS UNKNOWN. `screener.db` was not opened this
> pass, so the `screen_alert_subs` row count is unmeasured — and it is the number that
> decides whether this comparison can observe anything at all. A dark run over zero
> subscriptions prints four zeroes and reads [as healthy]."*

**Measured 2026-09-25 21:0xZ, read-only on the pod** (`/data/screener.db`):

| table | rows | distinct users |
|---|---|---|
| `screen_alert_subs` | **4** | **2** |
| `screen_alerts_fired` | **4** | **1** |

So: the subscriptions exist (4 subs across 2 members — the owner's three plus the smoke
account's one, which is CARD 2's *"≥ 3 definitions held by ≥ 2 real members"* satisfied on
the **arming** side), and **every one of the four fires belongs to a single user.** The
owner's three definitions have subscriptions and **zero fires**.

⭐ **The predicate is keyed on FIRES, not on subscriptions** (`reasons = {"fires": 4}`),
so a subscribed definition that has not fired produces **no predicate at all**. CARD 2's
FLIP bar — *"legacy_only == 0 over ≥ 5 sessions on ≥ 3 definitions held by ≥ 2 real
members"* — therefore cannot be reached by waiting five sessions. It requires those three
screens to **fire**, which depends on real membership movement in 26wk HV / Above 50 on
volume / Oops Reversal.

**This is the same trap CARD 1 already hit and already fixed once.** CARD 1's original
`agreed ≥ 20` bar was replaced because the measured base rate made it a 200-session wait;
CARD 2's bar is unbounded in the same way, for the same structural reason, and the report
reads healthy at `predicate_count 1` the entire time. It is a decision for the owner, and
the honest options are in §5's CARD 2 row.

---

## ✅ CLOSED THE SAME EVENING — the report now states this itself (`4885dadc2`)

The hand probe above is no longer how anyone learns this. `arming_census()` shipped in
`4885dadc2` (web SUCCESS 21:41:53Z) and the live admin dark report now answers it directly:

```
predicate_count: 1
subscriptions: 4 | members: 2 | definitions: 3 | definitions_with_a_comparison: 1
ARMED BUT NEVER COMPARED:
    sha256:f8d8650d0 — Above 50 on volume
    sha256:fd0e04f2a — 26wk HV
```

⭐ **The product reproduced the hand probe exactly, and explains the arithmetic the probe
could not.** Four subscriptions across two members but only **three distinct definitions** —
the owner's third screen (Oops Reversal) is the one **shared with the smoke account's
definition**, which is why exactly one definition has a comparison and the other two are
named as armed and silent. The 2 + 1 split is the whole finding, now printed beside
`predicate_count` instead of being invisible behind it.

Verified on the live payload: no `user_id` appears anywhere in the census.

---

## What the agent is doing about it, without being asked again

* The daily read continues per §9, and now **always reports `legacy_only` and the
  predicate count** — the two things the previous records omitted.
* CARD 1: re-read each session; the earliest possible bar date is 2026-10-01.
* CARD 2: the 09-26 tick gives the smoke predicate a verdict at n = 1; that is reported as
  n = 1, never as the bar.
* ⚰️ **Instrument note, recorded because it nearly went into this file as a finding:** the
  first pass of this read printed through `tail -14` and showed 14 of 18 rows, all with
  `legacy_only = 0`. That view supported two false claims at once — *"the population shrank
  18 → 14"* and *"one of the owner's five is missing"* — and the whole 2,344 lives in the
  four rows the pipe cut off. **A count read from a truncated view is a property of the
  pipe.** Read the JSON.
