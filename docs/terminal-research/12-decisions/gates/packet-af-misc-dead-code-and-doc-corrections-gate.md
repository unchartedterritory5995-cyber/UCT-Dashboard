---
id: PACKET-AF
title: RG-42 — five small "computed but never surfaced" findings from the Waves 1-7 audit, bundled and independently re-verified — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET AF — five small, independent findings, one gate

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs any of the files touched
> below. **Non-collision, checked twice, and the ground moved between checks — recorded exactly,
> not smoothed over.** First check (drafting time): grepped `docs/terminal-research/12-decisions/gates/*.md`
> and the root `.scopes/` directory in **both** worktrees for `packet-a[a-z]-`. Claimed
> double-letters: **AA** (`packet-aa-flow-explain-wiring-gate.md`, RG-38), **AB**
> (`packet-ab-screener-match-count-preview-gate.md`, RG-39), **AC**
> (`packet-ac-post-signup-referral-apply-gate.md`, RG-37), **AE**
> (`packet-ae-voice-risk-dashboard-orphan-decision-gate.md`, RG-40 — present but uncommitted, a
> sibling agent's in-flight work). **AD** was reserved per the dispatching instructions (a sibling
> agent drafting it) even though no `packet-ad-*` file had landed yet. `RG-41` was free at this
> point, and this packet was drafted as RG-41. **Second check, immediately before this commit:**
> both **AD** (`packet-ad-voice-compass-observability-visibility-gate.md`) and **AE** had by then
> landed as real commits (`daedad472`, `0bfd3e893` on `terminal-research`) — AD's packet claimed
> **RG-41**, the number this packet had drafted under. **This packet was renumbered to RG-42**
> (title, this block, and `RESEARCH_GAPS.md`'s new row all updated together) precisely because the
> second check is not a formality — the letter **AF** itself never collided at either check and
> needed no change, but the RG number did, and only the second check caught it. `PACKET-AF`
> appears nowhere in either worktree at either check. No `PACKET-` string collision anywhere in
> `s7-price-level`.

⛔ **FIVE INDEPENDENT, NARROWLY-SCOPED FINDINGS, ONE PER CHECKPOINT — bundled under one gate
because each is small and unrelated to the others.** An owner may approve any subset via
`SCOPE APPROVED:` naming exactly which CPs, per this repo's multi-checkpoint convention
(`PACKET-K`, `PACKET-S`). None redesigns anything: one route deletion, one route deletion, one new
admin route, one comment correction (**plus an explicit correction to the task's own premise for
half of it**, found only by re-verifying instead of trusting the description — see §1d), and one
documentation fix touching three passages of `CLAUDE.md`.

---

## 1 · Re-verification, all five items, against CURRENT source, 2026-09-22

Every claim below was checked by reading the actual file in the `s7-price-level` worktree today —
none carried forward from the task description without independent confirmation. Two corrections
came out of this pass (§1c, §1d) and are called out where they occur, not smoothed over.

### 1a · CP1 — `GET /api/auth/faq-vote/{faq_id}` (singular) — dead duplicate, CONFIRMED

`api/routers/auth.py:1550-1579` — three routes at the same path family:

```
1556  @router.post("/faq-vote/{faq_id}")           # cast a vote — CALLED
1564  @router.delete("/faq-vote/{faq_id}")          # withdraw a vote — CALLED
1570  @router.get("/faq-vote/{faq_id}")             # per-article summary — NOT CALLED
1576  @router.get("/faq-votes")                     # batch, ALL articles — CALLED
```

`app/src/pages/Support.jsx` — confirmed by grep for `faq-vote`/`faq-votes`, all three hits:

```
745   fetch('/api/auth/faq-votes')                  # the plural batch GET — hydrates every
                                                      # article's counts in one round trip
772   fetch(`/api/auth/faq-vote/${faqId}`, { method: 'DELETE' }).catch(() => {})
774   fetch(`/api/auth/faq-vote/${faqId}`, { ... POST ... })
```

Zero occurrences of a singular `GET` call anywhere in `app/src`. Zero test coverage of the route
(`tests/` has no file matching `faq` at all — grepped fresh).

⭐ **Load-bearing distinction, confirmed by reading `auth_service.py:1498-1554`:** the SERVICE
function `get_faq_vote_summary()` that the dead route calls is **not itself dead** — `set_faq_vote()`
(:1504-1517) and `clear_faq_vote()` (:1520-1528), which back the two routes Support.jsx DOES call,
both call it internally to build their own response body (the updated summary after a vote is
cast/withdrawn). **CP1 deletes the four-line router wrapper only** (`api/routers/auth.py:1570-1573`,
the `get_faq_vote` handler + its `@router.get` decorator) — the shared service function, and the
`FaqVoteRequest` model used by the POST route, are untouched.

### 1b · CP2 — `GET /api/j2/broker/cash-flows` — superseded duplicate, CONFIRMED

`api/routers/broker_sync.py:568-581`:

```python
@router.get("/cash-flows")
def cash_flows(accountId: str | None = None, period: str = "ALL",
               user: dict = Depends(get_current_user)) -> dict[str, Any]:
    ...
    return {"flows": cashflow_store.list_flows(user["id"], acct, start=start)}
```

Zero occurrences of `cash-flows`/`cashFlows`/`cash_flows` anywhere in `app/src` (grepped fresh).

**The same data already ships embedded.** `api/services/journal_two/broker/performance_service.py`
sets `result["flows"] = cashflow_store.list_flows(...)` on **three** code paths (`:100`, `:149`,
account-level; `:211-229`, portfolio-level aggregation across all connected accounts) — i.e. every
shape `GET /api/j2/broker/performance` can return already carries the exact same flows list this
standalone route recomputes from the same store function.

`app/src/pages/journal-2-0/components/PerformancePanel.jsx` already renders it fully:

```
70    const flowMarks = (data.flows || []).filter((f) => f.isExternal).map(...)
161   {(data.flows || []).length === 0 ? (
163       <div>Transactions</div>
164       <div>No cash flows in this period.</div>
186   <span>Transactions ({data.flows.length})</span>
191   {data.flows.map((f, i) => ( ... ))}
```

A real, itemized "Transactions (N)" list, sourced from `/performance`'s embedded `flows`, already
on screen. **This standalone route is a fully superseded duplicate.**

⚠️ **Unlike CP1, this one has live test coverage of the HTTP route itself**, found by grep:
`tests/test_broker_router.py::test_performance_and_cash_flows_endpoints` (`:132-166`) calls both
`/performance` and, at `:165`, `/cash-flows` directly and asserts on its `flows` shape. CP1 needed no
test change; **CP2 does** — the last four lines of that test (the `/cash-flows` assertion) must be
removed or moved when the route goes, or the suite reds on a route this packet deleted on purpose.
The underlying `cashflow_store.list_flows()` function stays — only the router wrapper goes.

### 1c · CP3 — `POST /api/j2/broker/backfill-history` — missing ops lever, CONFIRMED, and a scoping correction

`api/routers/broker_sync.py:174-181`:

```python
@router.post("/backfill-history")
def backfill_history(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    """... Heals the 1W/1M/3M/YTD/ALL hero ranges after a disconnect wiped the
    snapshot history. Idempotent and strictly additive ..."""
    from api.services.journal_two.broker import history_backfill
    return {"results": history_backfill.backfill_all_accounts(user["id"])}
```

Confirmed: `get_current_user` — any signed-in member, no admin-role check, no `PUSH_SECRET` bearer
— unlike the file's six `/admin/*` diagnostic routes (`reset-partner-auth-broken`,
`redate-equity-snapshots`, `option-mark-compare`, `drift-series`, `broker-coverage`,
`ledger-conservation`, all `:243-430`), every one of which uses the identical pattern:

```python
expected = os.environ.get("PUSH_SECRET", "")
auth = request.headers.get("authorization", "")
if not expected or not hmac.compare_digest(auth, f"Bearer {expected}"):
    raise HTTPException(status_code=401, detail="unauthorized")
```

⚠️ **Scoping correction against the task's own framing:** the task describes this route as lacking
a gate "unlike every sibling ops route in this file." Precisely: two of the file's eight admin
routes (`admin/user-debug`, `admin/live-checks`, plus `admin/fidelity-audit`, `admin/stats`) use
`Depends(require_admin)` instead of the `PUSH_SECRET` bearer pattern — so "every sibling" is not
literally true of the auth *mechanism*, only of the fact that `backfill-history` is the only ops
repair lever in the file gated on **plain member session** with **no admin/ops distinction of any
kind**, and the only one not living under `/admin/`. That distinction is what CP3 actually closes.

**Automatic path confirmed:** `api/services/journal_two/broker/sync.py:657` calls
`_hb.maybe_backfill_after_initial_sync(user_id, ba)` (defined
`history_backfill.py:116`) — this fires after a fresh connect, not as a general-purpose recovery
lever reachable if the automatic path misses (a mid-flight restart, a connect that predates this
code).

**Zero frontend callers** (grepped `backfill-history`/`backfillHistory`/`backfill_history`, all of
`app/src`, empty) — so today this lever is reachable only by a signed-in member hand-crafting a
`fetch()` to their own session, which is not a real recovery path for anyone, member or ops.
`tests/test_broker_history_backfill.py:132-136` (`test_route_is_mounted`) only asserts the path
`/api/j2/broker/backfill-history` exists in the router's route table — it does not test the auth
dependency, so it stays green whether CP3 is a **new, additional** route or a change to this one.

**CP3 is additive**, per the task's own framing: add `POST /admin/backfill-history` (a new path,
under this file's existing `/admin/` prefix), PUSH_SECRET-bearer gated like its six siblings, taking
a `user_id` param (mirroring `admin_user_debug(user_id, ...)`) so it works as an ops lever without a
member session. **The existing member-facing `/backfill-history` is left untouched** — it is not
itself broken, merely unreachable by anyone but the member it belongs to via a hand-typed request,
which is a separate (smaller, UI-side) gap this packet does not take on.

### 1d · CP4 — `live_massive_router.py` `/status` + `/curated` — the comment is FALSE, but re-verification OVERTURNS the "both are dead" premise

`api/live_massive_router.py:2241-2298`, both routes carry **no `Depends(...)` at all — confirmed
no auth**:

```
2256  @router.get("/status")     # status_shim() — no auth
2273  @router.get("/curated")    # curated_shim() — no auth
```

The comment directly above them (`:2247-2249`):

> *"Cleaner server-side, but the frontend was never migrated -- OptionsFlow.jsx,
> OptionsFlow_admin.jsx, and LiveFlowMassive.jsx still call the old paths"*

**Confirmed FALSE, exhaustively, file by file:**

- `OptionsFlow.jsx` — grepped every `live/massive` reference: calls only `/api/live/massive/thresholds`
  (`:3056`). **Zero** references to `/status` or `/curated`.
- `OptionsFlow_admin.jsx` — grepped `/api/live` across all 9,972 lines: **zero matches, of any kind.**
  This file does not call the live-massive router at all, old paths or new.
- `LiveFlowMassive.jsx` — calls `/api/live/massive/recent` (`:3782`, the CONSOLIDATED endpoint the
  comment says should replace the old ones) and `/api/live/massive/curated-stream` (`:3940`, a
  **different, SSE** endpoint defined in `massive_stream_router.py`, not the bare `/curated` this
  comment is about).

Repo-wide grep for the bare paths (`live/massive/status`, `live/massive/curated` excluding
`-stream`) across all of `app/src` returns **zero** hits. **The comment's central claim — that these
three named files still depend on the old paths — is false in every particular.** This part of the
task's finding stands exactly as described.

⛔⛔ **But re-verifying past the comment finds the task's framing of "two dead shims" is itself
wrong for one of the two, and this packet corrects it rather than repeating it.**

`api/services/liveflow_monitor.py` (docstring `:1-27`) is an **independent live-flow outage
monitor** running on the worker service:

```
10   - Poll GET /api/live/massive/status every 60s during market sessions.
11   - PRIMARY staleness oracle = max_id delta between polls ...
```
```
44   STATUS_URL = os.environ.get("LIVEFLOW_STATUS_URL", f"{WEB_ORIGIN}/api/live/massive/status")
```

Its own docstring: *"Would have caught all 16 downtime windows on 2026-07-06."* This is a real,
currently-live, critical operational consumer of `GET /status` — a 2-consecutive-confirm /
10-minute-escalation / 30-minute-renag alerting state machine, not a frontend page. It is invisible
to a frontend-only grep, which is exactly why the task's own description (reasonably, from the
comment alone) called both routes "dead." **They are not equally dead.** Tracing the plumbing:
`api/flow_proxy.py:64` proxies `/api/live/massive` from web to `WORKER_INTERNAL_URL` (when
`FLOW_READS_PROXY_ENABLED=1`), registered **before** the local router per `CLAUDE.md`'s P5-cutover
section — and `api/flow_worker_main.py` (`:568, 871`) imports and drives `live_massive_router`
directly, confirming this router's actual handlers execute on the **flow-worker** service, reached
from `liveflow_monitor.py`'s poll of the public `WEB_ORIGIN` through that proxy. **Deleting
`/status` would break this outage monitor's primary staleness signal.**

`/curated` (bare, not `-stream`) has a genuinely different profile: the only textual reference
anywhere in the repo outside `live_massive_router.py` and its own tests is
`api/hypothesis_sheet.py:352` —

```python
print(f"const CURATED = await fetch('/api/live/massive/curated?limit=5000&date=2026-07-07')...")
```

— a `print()` statement inside a one-off manual analysis script that emits example browser-console
JS for a human to paste, with a hardcoded stale date (2026-07-07). It is not an executed call by
any running code. `tests/test_flow_proxy.py` uses `/api/live/massive/status` merely as a
representative path to test the generic proxy-forwarding mechanism (not this shim's own logic, and
it doesn't use `/curated` at all); `tests/test_schwab_partner_fixes.py`'s `CURATED` constant
documents a regression test for a real bug this shim once had (a permanent 500 from two omitted
params), not evidence of a live caller. **`/curated` looks genuinely unused** — but given that
`/status` just demonstrated a real caller invisible to every check available from inside this repo
(an ops monitor polling a public URL, doing its actual work on a different service), this packet
does **not** propose deleting it on the strength of a repo grep alone.

**CP4 therefore does not delete either route.** It corrects the false comment (and the routes'
docstrings, which repeat the same wrong migration story) to state what re-verification actually
found, and explicitly documents `/status` as **load-bearing ops infrastructure**, not a
backward-compat shim — a mislabeling that could otherwise get it deleted by a future cleanup pass
reading the same false comment this packet found. `/curated`'s disposition is left **an open
question for the next session with ops/Ravi visibility this repo grep cannot have**, not decided
here.

### 1e · CP5 — two `CLAUDE.md` corrections, CONFIRMED, wording drafted

**(a) OptionsFlow mobile hooks list is stale.** Current text (`CLAUDE.md`, "OptionsFlow mobile"
subsection): *"Hooks in use: `of-mroot` (root), `of-tabs` (tab bar),
`of-chiprow`/`of-chiprow-seg`/`of-chiprow-wrap` (filter strips → horizontal scroll, 44px), `of-tip`
(theme-help ⓘ, tap-toggled via a `data-pin` flag so the touch mouseenter→click ordering doesn't
cancel it)."*

Every `of-`-prefixed `className` actually present in `OptionsFlow.jsx` today (regex-extracted,
whole file):

```
of-chiprow-seg   of-chiprow-wrap   of-fetchpl   of-mroot
of-order         of-pickrow        of-picks     of-refresh   of-tabs
```

`data-pin` (any casing/spelling) does not appear anywhere in the file. **Confirmed exactly as the
task described:** `of-tip` and `data-pin` are gone. Also gone: the *bare* `of-chiprow` (only the
`-seg`/`-wrap` variants exist — the doc's own `/` listing implied a third, undifferentiated one).
Also **undocumented but present**: `of-fetchpl`, `of-order`, `of-pickrow`, `of-picks`, `of-refresh`
— five hooks CLAUDE.md never mentioned. ⭐ **`OptionsFlow.mobile.css` still declares `.of-tip` and
bare `.of-chiprow` selectors** (grepped) that now match nothing in the JSX — dead CSS this packet
does not touch (no code change proposed here; CP5 is docs-only).

**(b) `BrokerEquityCurve` is claimed orphaned; it is not.** Fresh read of both files named in the
task:

```
app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx:33   import BrokerEquityCurve from '../components/broker/BrokerEquityCurve'
app/src/pages/journal-2-0/tabs/OpenPositionsTab.jsx:381  <BrokerEquityCurve liveNetLiq={...} />
app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx:26       import BrokerEquityCurve from '../components/broker/BrokerEquityCurve'
app/src/pages/journal-2-0/tabs/AnalyticsTab.jsx:164      <BrokerEquityCurve compact />
```

`app/src/pages/journal-2-0/components/broker/BrokerEquityCurve.jsx` exists (6.2KB, modified
2026-09-11), reads via `GET /api/j2/broker/equity-curve` (a real route, `broker_sync.py:496-524`,
backed by `j2_broker_equity_snapshots` — the same table CLAUDE.md's unreachable-table row says
"nothing draws"). **Confirmed: the component is imported and rendered on both surfaces the task
named, is not orphaned, and the data it draws from is not going undrawn.** One nuance worth
recording precisely rather than overclaiming: `hooks/useBrokerEquityCurve.js` — the hook CLAUDE.md
names alongside the component as deleted — genuinely does **not** exist (grepped, no match
anywhere); the live component fetches directly via the shared `useMobileSWR` hook instead. So the
component came back (or was never actually gone from where these two tabs render); the specific
named *hook* file did not.

The false claim is repeated in **three** places in `CLAUDE.md` (all citing the same stale fact,
which is why one correction must land in all three or the file keeps a second authority on its own
claim — `lesson_a_second_authority_over_one_value`):
1. The "⚰️ DOCUMENTED BUT UNREACHABLE" table's `BrokerEquityCurve` row (says 🗑️ DELETED).
2. "Broker Sync (SnapTrade)" → FE file list: *"This list also named `BrokerEquityCurve` and
   `BrokerSyncStatus`. Both are orphaned..."*
3. "UI surfaces" bullet: *"⚰️ (this said "real equity curve..." — `BrokerEquityCurve` has zero
   importers and no equity curve renders on this tab; see the unreachable table.)"*

Exact proposed replacement text for each is given under CP5 below.

---

## 2 · Proposed checkpoints

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | Delete the dead `GET /api/auth/faq-vote/{faq_id}` router wrapper | none | **XS** |
| **CP2** | Delete the superseded `GET /api/j2/broker/cash-flows` router wrapper + trim its test | none | **XS** |
| **CP3** | Add `POST /admin/backfill-history` (PUSH_SECRET-bearer, additive) to `broker_sync.py` | none | **S** |
| **CP4** | Correct the false comment + docstrings on `live_massive_router.py`'s two shims; delete neither | **partner file — Ravi ack required** | **XS** |
| **CP5** | Correct two stale `CLAUDE.md` passages (OptionsFlow hooks; `BrokerEquityCurve`, 3 spots) | none | **XS**, docs-only |

Each CP is independently approvable — `SCOPE APPROVED:` may name any subset (e.g. *"CP1, CP2, CP5
ONLY"*), per this repo's multi-checkpoint convention.

### CP1 — delete the dead singular FAQ-vote GET

**MUST-BUILD, exactly:**
1. `api/routers/auth.py`: delete the `@router.get("/faq-vote/{faq_id}")` decorator and its
   `get_faq_vote(faq_id, user)` handler (`:1570-1573`). Nothing else in the FAQ-vote block changes —
   the `FaqVoteRequest` model, the `POST`, the `DELETE`, and the plural `GET /faq-votes` all stay
   byte-identical.
2. `api/services/auth_service.py`: **no change.** `get_faq_vote_summary()` stays — it is still
   called by `set_faq_vote()` and `clear_faq_vote()`.

**Explicitly deferred:** nothing — this is the whole change.

**Risk: negligible.** Four lines deleted, zero frontend callers, zero test callers (confirmed by
grep — no file under `tests/` matches `faq` at all), zero other server-side callers of the deleted
route (only the shared service function remains referenced, and only by the two routes that stay).

### CP2 — delete the superseded standalone cash-flows GET

**MUST-BUILD, exactly:**
1. `api/routers/broker_sync.py`: delete the `@router.get("/cash-flows")` decorator and its
   `cash_flows(...)` handler (`:568-581`).
2. `tests/test_broker_router.py`: in `test_performance_and_cash_flows_endpoints` (`:132-166`),
   remove the trailing block that calls the deleted route (`:164-166`: the `r2 = client.get(...
   /cash-flows...)` call and its two assertions). The `/performance` half of the test (`:154-163`)
   is untouched and keeps covering the same `flows` data via its embedded shape.
3. `api/services/journal_two/broker/cashflow_store.py`: **no change.** `list_flows()` stays — it is
   still called from `performance_service.py`'s three code paths.

**Explicitly deferred:** any change to `PerformancePanel.jsx`'s existing "Transactions (N)"
rendering, or to `/performance`'s response shape — both already correct and untouched.

**Risk: low.** One route + a matching test assertion removed; the underlying store function and
every real consumer of the data are unaffected. The rename/removal is verified by re-running
`tests/test_broker_router.py` after the edit (must still pass with the trimmed test).

### CP3 — add an ops-diagnostic backfill lever

**MUST-BUILD, exactly:**
1. `api/routers/broker_sync.py`: add one new route, placed among this file's other `/admin/*`
   diagnostic routes (after `/admin/stats`, matching their order-of-appearance convention), e.g.:

   ```python
   @router.post("/admin/backfill-history")
   async def admin_backfill_history(request: Request, user_id: str) -> dict[str, Any]:
       """Ops lever: re-trigger a member's historical-equity backfill without their
       session. Mirrors the member-facing POST /backfill-history (same idempotent,
       strictly-additive replay), for the case where the automatic post-reconnect
       trigger (sync.py::maybe_backfill_after_initial_sync) missed — e.g. a restart
       mid-flight — and no UI button exists to re-run it by hand.

       Gated by the PUSH_SECRET bearer, like the other admin instruments.
       """
       expected = os.environ.get("PUSH_SECRET", "")
       auth = request.headers.get("authorization", "")
       if not expected or not hmac.compare_digest(auth, f"Bearer {expected}"):
           raise HTTPException(status_code=401, detail="unauthorized")
       from api.services.journal_two.broker import history_backfill
       return {"results": history_backfill.backfill_all_accounts(user_id)}
   ```

2. Nothing else changes. The existing member-facing `POST /backfill-history` (`:174-181`) is
   **untouched** — same path, same `get_current_user` gate, same behavior. This CP is purely
   additive: one new route, zero modified routes, zero frontend changes (explicitly "not a UI
   change," per the task).

**Explicitly deferred:** exposing this as a member-facing UI button; changing the existing
`/backfill-history` route's auth; any change to `history_backfill.backfill_all_accounts()` itself
or to the automatic `maybe_backfill_after_initial_sync()` trigger path.

**Risk: low.** A single additive route, following the file's own established six-sibling pattern
exactly (same gate mechanism, same request/error shape), calling an already-idempotent,
already-additive function that the file's own docstring already describes as safe to re-run.
`tests/test_broker_history_backfill.py::test_route_is_mounted` continues to pass unmodified (it
checks a different path); a companion assertion for the new path is a natural addition at build
time but is not required to make the existing suite pass.

### CP4 — correct the false comment; explicitly do NOT delete either shim

⚠️⚠️ **`api/live_massive_router.py` is PARTNER-OWNED** (Ravi co-edits it, per `CLAUDE.md`'s
`project_partner_collab_branch` note and the file's own "FOR RAVI" precedent section). **This
checkpoint requires the owner's coordination/ack with Ravi before it lands — same treatment as
Packet AA's CP2 — even though the change proposed is a comment/docstring correction with no
behavioral difference, not a deletion.** Given this file's own recent history (`_parse_mdy`, see its
"FOR RAVI" section) of two definitions silently diverging because nobody flagged an edit before it
landed, a coordination step costs nothing and this file has already paid for skipping it once.

**MUST-BUILD, exactly:**
1. `api/live_massive_router.py:2241-2255`: replace the comment block. Current text asserts a false
   migration story (§1d). Replacement, re-verified 2026-09-22:

   > `--- Two endpoints with different lifecycles, despite the shared "shim" name -------------`
   > `#`
   > `# /status: NOT a dead shim. api/services/liveflow_monitor.py polls this path every 60s`
   > `# (via WEB_ORIGIN, proxied to this service by flow_proxy.py) as the PRIMARY staleness`
   > `# oracle for the independent live-flow outage monitor -- a real, currently-live ops`
   > `# consumer, invisible to a frontend grep because it is not a frontend. Re-verified`
   > `# 2026-09-22: OptionsFlow.jsx, OptionsFlow_admin.jsx and LiveFlowMassive.jsx do NOT call`
   > `# this path (the original comment claiming they do was false) -- but do not delete it on`
   > `# that basis; something else depends on it.`
   > `#`
   > `# /curated: no confirmed live caller found (2026-09-22 audit) -- the only repo reference`
   > `# outside this file and its own tests is a print() in hypothesis_sheet.py emitting`
   > `# example browser-console JS for a human to paste, with a hardcoded stale date. Looks`
   > `# genuinely unused, but /status just demonstrated that "no caller visible from inside`
   > `# this repo" is not the same claim as "no caller" -- its disposition is left open pending`
   > `# ops/Ravi visibility this repo grep cannot have.`

2. `status_shim()`'s docstring (`:2258-2264`) and `curated_shim()`'s docstring (`:2281-2284`): drop
   the "New frontend code should read status from /recent's envelope instead" /
   "New frontend code should call GET /recent?curated=true directly" sentences from BOTH — they
   repeat the same false premise that a frontend migration is pending. Replace with a one-line
   pointer to the corrected block comment above, so the docstring doesn't independently keep the
   wrong story alive if the block comment is ever edited alone.

**Explicitly deferred / NOT authorized by this checkpoint:**
- Deleting `/status` — confirmed load-bearing (§1d).
- Deleting `/curated` — plausible but not confirmed safe from inside this repo; left for a session
  with ops/Ravi visibility.
- Any change to `_get_worker_status()`, `_curated_health()`, or `recent_massive_alerts()`.

**Risk: low, but not zero, hence the partner-ack requirement.** A comment-only change cannot alter
behavior, but it is a hand-edit to a large (~6,000+ line), actively co-edited, partner-owned file,
and this packet's own re-verification (§1d) is the demonstration of why "obviously dead, obviously
safe" calls in this exact file have gone wrong before.

### CP5 — two `CLAUDE.md` corrections (docs-only, no code change)

**MUST-BUILD, exactly — replace, verbatim:**

**(a) OptionsFlow mobile hooks list.** Replace the current sentence (*"Hooks in use: `of-mroot`
(root), `of-tabs` (tab bar), `of-chiprow`/`of-chiprow-seg`/`of-chiprow-wrap` (filter strips →
horizontal scroll, 44px), `of-tip` (theme-help ⓘ, tap-toggled via a `data-pin` flag so the touch
mouseenter→click ordering doesn't cancel it)."*) with:

> Hooks in use, verified against `OptionsFlow.jsx` source 2026-09-22: `of-mroot` (root), `of-tabs`
> (tab bar), `of-chiprow-seg`/`of-chiprow-wrap` (filter strips → horizontal scroll, 44px), plus
> `of-fetchpl`/`of-order`/`of-pickrow`/`of-picks`/`of-refresh` (present, not previously documented
> here). ⚰️ **`of-tip` and its `data-pin` tap-toggle are GONE** — the theme-help ⓘ hook this line
> described no longer exists in the component. `OptionsFlow.mobile.css` still declares `.of-tip`
> and a bare `.of-chiprow` selector that now match nothing in the JSX (dead CSS, not a live hook) —
> a cleanup candidate, not corrected here.

**(b) `BrokerEquityCurve` — three passages, same false fact, corrected together:**

1. The "⚰️ DOCUMENTED BUT UNREACHABLE" table row for
   `journal-2-0/components/BrokerEquityCurve.jsx` + `hooks/useBrokerEquityCurve.js`: remove this
   row from the table entirely (it is the table's single owner-of-record for unreachable claims,
   and this claim is false) and replace it with a corrected note placed directly below the table:

   > ✅ **CORRECTED 2026-09-22 — `BrokerEquityCurve` is NOT orphaned; this table previously said
   > 🗑️ DELETED.** `journal-2-0/components/broker/BrokerEquityCurve.jsx` exists, is imported and
   > rendered on both `OpenPositionsTab.jsx` (`:33,381`) and `AnalyticsTab.jsx` (`:26,164`,
   > `compact`), and reads real data via `GET /api/j2/broker/equity-curve` over
   > `j2_broker_equity_snapshots`. ⚠️ `hooks/useBrokerEquityCurve.js` — the hook this row also
   > named — genuinely does not exist; the live component calls the shared `useMobileSWR` hook
   > directly instead. The component came back (or never left where these two tabs render); the
   > named hook file did not.

2. "Broker Sync (SnapTrade)" → FE file list: replace *"⚰️ This list also named `BrokerEquityCurve`
   and `BrokerSyncStatus`. Both are orphaned — see *⚰️ DOCUMENTED BUT UNREACHABLE* near the top.
   `SyncTrustCenter` is what actually renders the sync bar."* with:

   > ⚰️ This list also named `BrokerSyncStatus`, which **is** orphaned — see *⚰️ DOCUMENTED BUT
   > UNREACHABLE* near the top; `SyncTrustCenter` is what renders the sync bar. `BrokerEquityCurve`
   > was also named here and previously marked orphaned too — **that was wrong, corrected
   > 2026-09-22**: it is live on `OpenPositionsTab.jsx` and `AnalyticsTab.jsx` (see the correction
   > below the unreachable table).

3. "UI surfaces" bullet: replace *"⚰️ *(this said "real **equity curve** (from net-liq snapshots)"
   — `BrokerEquityCurve` has zero importers and no equity curve renders on this tab; see the
   unreachable table.)*"* with:

   > ✅ *(this said `BrokerEquityCurve` had zero importers — **wrong, corrected 2026-09-22**; it
   > renders on this tab today, see the correction below the unreachable table.)*

**Explicitly deferred:** removing the now-dead `.of-tip`/bare-`.of-chiprow` CSS selectors from
`OptionsFlow.mobile.css` (a real, small follow-up this re-verification surfaced but the task did
not ask for); any change to `BrokerEquityCurve.jsx`, `OpenPositionsTab.jsx`, or `AnalyticsTab.jsx`
themselves.

**Risk: none.** Documentation only, no code touched, no test affected.

### Explicitly deferred, NOT authorized by this packet (all checkpoints)

- Deleting `live_massive_router.py`'s `/status` (confirmed unsafe) or `/curated` (unconfirmed
  either way) — see CP4.
- Any change to `OptionsFlow.jsx`, `OptionsFlow_admin.jsx`, or `LiveFlowMassive.jsx` themselves.
- Any UI work exposing `POST /backfill-history` (member-facing) as a button.
- Removing the dead `.of-tip`/`.of-chiprow` CSS rules named in CP5(a).

### Risk

**Low, per checkpoint, independently.** CP1 and CP2 each delete one small, genuinely unreached
route while leaving every underlying service function and every real consumer untouched; CP2 also
trims one test assertion that would otherwise red on a deletion this packet intends. CP3 adds one
new route with zero modification to any existing one, following an established six-sibling pattern
exactly. CP4 is a comment/docstring correction with explicit non-deletion as its main output — the
riskiest-looking item in the batch turned out, on re-verification, to require *restraint* rather
than a code change, which is the finding worth a reviewer's attention. CP5 is documentation-only.
None of the five touches `api/main.py`'s scheduler wiring, any endpoint's response *contract* (only
CP1/CP2 remove endpoints nothing calls), or any frontend route.
