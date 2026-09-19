---
id: s6-cp4-build-record
unit: CP4
packet: s6-personalization-pre-implementation-gate
merges-after: d5-cp6-build-record
status: UNSIGNED
---

# S6 CP4 — build record

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner; delegated to the running Claude Code session, 2026-09-18)
APPROVED ON:      2026-09-18
APPROVED AT SHA:  78268f5e0
SCOPE APPROVED:   CP4
```

> **S6 CP4 — `GET /api/member/interest` + the shared per-member cache
> key.** The packet's §4 row: *"GET /api/member/interest + the shared
> per-member cache key."* Member-visible: **no** (a new endpoint with no
> UI caller — same "ships dark, endpoint-only" discipline as D5 CP7).
> Size **S/M**. Blocked on: SPEC §2 (already resolved, CP2'/CP3) and
> *"the paid-gating question SPEC §5.1 leaves open"* (Decision Card 4).
>
> **Decision Card 4, resolved this turn under explicit owner delegation
> ("make judgement calls on everything remaining"):** PAID. Reasoning: the
> sibling endpoint already serving this SAME underlying data —
> `GET /api/calendar/my-sets` (`api/routers/calendar.py`, `require_paid`) —
> is already paid-gated. This endpoint returns a richer (weighted,
> provenance-carrying) shape over the identical four sources; gating it
> more loosely than the plain-set endpoint already serving the same data
> would open a second, weaker door onto information the first door already
> protects. This is not a monetization-strategy decision invented from
> nothing — it is matching an existing, already-shipped gate on the same
> underlying data.

## 0 · The design decisions this checkpoint had to make, beyond the ruling

**Not on `_access_payload`.** SPEC §3.2's own comparison table (S12 cohort
vs S6 interest) is explicit that an entity set is a member's whole
watchlist+tags+positions, changing on every flag/position write, needing
near-real-time freshness — categorically unlike the "a few short strings,
next-request-is-fine" shape `_access_payload` already carries on every
authenticated request. Putting this on that path would be the
`/api/live-prices` mistake (unthrottled per-request work on the universal
auth path — the 2026-07-01 outage's own keystone rule) in a new costume.
This route is its own GET, its own dependency, its own cache.

**Cached with a short TTL instead of "invalidated on write."** The spec's
§3.2 language names invalidate-on-write as its own suggested mechanism for
the stated freshness requirement ("must reflect the flag they set ten
seconds ago"). Wiring invalidation into every existing watchlist/tag/
position mutation endpoint (the watchlist router, the tag service, J2's
position writers — none of which this checkpoint's own ~40-line sizing
(SPEC §5's table) has room for) would be a cross-cutting change to several
OTHER routers' files. A 15-second TTL — the SAME bound `/api/live-prices`
already gives every member for a live quote, and the exact number the
spec's own sentence names — satisfies the identical freshness requirement
without touching anything outside this one new file.

**`require_paid` defined locally, not imported.** This codebase's own
tested, mutation-proved rule (`tests/test_user_definitions_auth.py::
test_require_paid_is_defined_PER_ROUTER_and_this_task_invented_no_shared_one`):
each router that gates on `require_paid` defines its OWN copy with its OWN
402 sentence, so a support ticket can identify which surface refused a
member from the message text alone. Importing calendar.py's copy would be
"the shared gate wearing a different hat" — exactly the pattern that rail
exists to catch.

**Response shape is `{"entities": {...}}` only.** `member_interest.
interest_for`'s richer return (`by_source`, `all_mine`, `entities`) is
trimmed to just `entities` on the wire — `by_source`/`all_mine` are
`/api/calendar/my-sets`' own shape (the CP2' migration's no-op contract),
not this endpoint's. This is SPEC §3.3's actual ask: *"every entity carries
WHY it is there"* — the `because[]` field, already present per-entity,
needing no separate exposure of the raw source sets.

## 1 · What this builds

**New `api/routers/member.py`**: one route,
`GET /api/member/interest`, gated by a locally-defined `require_paid`,
reading/writing the shared `api.services.cache` singleton under key
`member_interest:{user_id}` (15s TTL), calling
`member_interest.interest_for(user_id)` and returning `{"entities": ...}`.
Registered in `api/main.py` immediately after the calendar router.

## 2 · Controls

```
python -m pytest tests/test_member_router.py -q
                                                           6 passed, 0 failed
python -m pytest tests/test_user_definitions_auth.py -q
                                                           6 passed, 0 failed
python -c "from api.main import app; print(len(app.routes))"
                                                           1368 (was 1367 pre-change)
```

6 new tests: a free member refused 402 (dependency-override on
`get_current_user_with_plan`, the gate's INPUT — never on `require_paid`
itself, per the same codebase idiom `test_calendar_seen.py` already uses),
a paid member gets the resolver's answer, the response never leaks
`by_source`/`all_mine`, the LOAD-BEARING case (ten requests for one member
inside the TTL window compute the resolver exactly once), per-member cache
isolation (two different members' answers never cross), and a TTL-expiry
re-read.

**Mutation, run this turn:** collapsed the real `_cache_key(user_id)` in
`api/routers/member.py` to a constant string (`"member_interest:shared"`,
dropping the `user_id` interpolation) → `test_two_different_members_never_
share_a_cache_entry` went RED. Restored from a pre-mutation backup;
reverified green (6/6, then the full combined regression below).

## 3 · Files

```
api/routers/member.py           new, ~55 lines (excl. docstring)
api/main.py                     modified, +2 lines (router import + include)
tests/test_member_router.py     new, 6 tests incl. 1 mutation proof
```

Committed on `feat/s7-price-level` at `359190d4d`.

## 4 · Validators

```
ast.parse the new/modified files                                     OK
scoped pytest, this checkpoint's own file                             6 passed, 0 failed
scoped pytest, the per-router require_paid rail                       6 passed, 0 failed
app import + route-count sanity check                                 1368 routes, +1 as expected
mutation ladder (1 arm, load-bearing)                                 confirmed RED then restored
```

## 5 · member_visible classification

`api/routers/member.py` is under the `api/routers/` member-surface root
(K CP15) — a genuinely new, reachable HTTP endpoint, even with zero UI
callers today (same reasoning already applied to D5 CP7). Registered
`member_visible=True` in `merge_all.py`'s UNITS list; `#!last:` moves to
this checkpoint.

## 6 · Drafted ledger row — NOT written

| 133 | `359190d4d` | 2026-09-18 | BACKEND | 1 | S6 CP4: `GET /api/member/interest`, the resolver's own seam with a shared per-member cache key (15s TTL, matching `/api/live-prices`' own precedent, chosen over invalidate-on-write to stay within this checkpoint's own sizing). Paid-gated to match the sibling `/api/calendar/my-sets` endpoint already serving this data (Decision Card 4, resolved under explicit owner delegation). Ships with no UI caller -- endpoint-only, same discipline as D5 CP7. |
