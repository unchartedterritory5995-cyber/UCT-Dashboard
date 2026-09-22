---
id: PACKET-N
title: COT Data's dead self-heal signal and drifting symbol picker — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET N — restoring a documented COT safety net that never fires

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-N` appears nowhere in either worktree (checked before writing this
> file — `PACKET-K` is taken by an unrelated 2026-09-14 packet).

⛔ **ZERO NEW BACKEND CODE.** Both endpoints already exist, correct, `require_paid`-gated, and
test-covered. This packet wires two existing reads into `CotData.jsx`.

---

## 1 · The gap, checked directly against source

CLAUDE.md's own COT section documents **three independent defense layers** against stale CFTC
data: (1) an APScheduler job, (2) a calendar-aware startup catch-up, and (3) *"Request-driven
self-heal — `get_status()` invokes `_maybe_auto_refresh_if_stale()` on every call... Any visit to
the COT tab self-heals — no scheduler required."*

**Verified directly: layer 3 has never actually fired from a real member visit.**
`_maybe_auto_refresh_if_stale()` (`api/services/cot_service.py:542`) is called from exactly one
place — `cot_service.get_status()` (`:587`) — and `get_status()` is called from exactly one
place — `GET /api/cot/status` (`api/routers/cot.py:79-81`). Grepped every call site of both
functions across the whole `api/` tree; no other caller exists anywhere. **Grepped `app/src` for
`/api/cot/status` and found zero frontend callers.** So the endpoint that is supposed to trigger
per-visit self-healing has never been hit by a member opening the COT tab — layers 1 and 2 still
run independently and are unaffected, but the third layer this doc describes as "no scheduler
required" has in practice always required one.

**A second, smaller drift in the same area:** `GET /api/cot/symbols` (`api/routers/cot.py:64-75`)
returns the backend's own `SYMBOL_GROUPS`/`SYMBOL_NAMES` — also zero frontend callers.
`CotData.jsx` instead hardcodes its own copy of both (lines 38-71), and the backend's own comment
above its `SYMBOL_GROUPS` declaration says outright: *"the set the COT tab pins at the top of its
picker... Keep the two in step."* **Verified the drift is real, not hypothetical:** the backend
declares a distinct `"INDICES"` group (`ES, NQ, YM, QR, EW, VI, NK`) that the frontend's hardcoded
copy has no equivalent for at all — those symbols currently only appear folded into
`"MOST WATCHED"` on the frontend. Not a correctness break (the symbols still render), but a
live instance of exactly the hand-maintained-duplicate defect class this codebase's own CLAUDE.md
calls out repeatedly elsewhere (the writer-index "FOUR", the setup-catalog "24").

Both endpoints are `require_paid`-gated (consistent with every other COT read) and both have
existing shape tests (`tests/api/test_cot_endpoints.py::test_get_status_shape` /
`test_get_symbols_structure`) — confirmed by reading them directly.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | Wire `/api/cot/status` (self-heal trigger + freshness line) and `/api/cot/symbols` (picker data) into `CotData.jsx` | none | **XS** |

### MUST-BUILD, exactly

1. **`CotData.jsx`**: add a `useSWR('/api/cot/status', fetcher)` call on tab mount (fire-and-forget
   is enough to trigger the self-heal; also surface a small, unobtrusive freshness line — e.g.
   "Data through {last_updated}" — near the symbol picker, using the response's `last_updated`/
   `record_count` fields).
2. **`CotData.jsx`**: replace the hardcoded `SYMBOL_NAMES`/`SYMBOL_GROUPS` constants with a
   `useSWR('/api/cot/symbols', fetcher)` call, keeping a hardcoded fallback (the current constants,
   renamed) for the brief loading window / a fetch failure — never a blank picker.
3. **`tests/test_cot_status_symbols_wiring.jsx`** or equivalent (new test file, or added to an
   existing `CotData.test.jsx` if one exists — check first): confirms the page fetches both
   endpoints on mount, renders the freshness line from real data, and falls back to the hardcoded
   symbol list without crashing when the `/symbols` fetch fails.
4. A rail test confirming the `"INDICES"` group (or whatever the live backend groups are, read
   dynamically — never re-hardcoded) is reachable from the picker once wired, closing the specific
   drift found above.

### Explicitly deferred, NOT authorized by this line

- Any change to `cot_service.get_status()`, `_maybe_auto_refresh_if_stale()`, or the refresh
  scheduling logic itself — layers 1 and 2 are untouched and already correct.
- Any change to `SYMBOL_GROUPS`/`SYMBOL_NAMES` on the backend (e.g. reconciling "MOST WATCHED"
  vs "INDICES" membership) — this packet only makes the frontend READ the backend's existing
  values instead of hand-copying them; it does not change what those values are.
- The Friday weekly Discord post's own symbol set (`api/services/cot_weekly_post.py`) — untouched.

### Risk

**Very low.** No backend change, no new write path. Worst case if the `/status` fetch fails: the
freshness line simply doesn't render (existing behavior, minus the line) and the self-heal trigger
silently doesn't fire that visit — no worse than today. Worst case if `/symbols` fails: the
hardcoded fallback keeps the picker exactly as it is today.
