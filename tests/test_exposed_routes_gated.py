"""🔴 THE ROUTES THE 2026-08-09 AUTH SWEEP FOUND OPEN ARE CLOSED, AND THE PROOF
IS DERIVED FROM `api.main:app` RATHER THAN FROM A LIST SOMEONE TYPED.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
`.superpowers/sdd/audit/auth-paywall-report.md` measured 253 routes reachable
with no credential of any kind. Two headline shapes:

  * `GET /api/top-flow/purge-old/{keep_days}` — a DESTRUCTIVE operation behind a
    SAFE verb. A GET is fetched by crawlers, Slack/Discord unfurl bots, browser
    prefetch and security scanners. `keep_days` came straight off the path, so
    `.../purge-old/0` archived every active pick, and one link preview was a
    data-loss event nobody requested.
  * 151 routes serving the firm's proprietary output to anybody —
    `GET /api/flow/data` at 3.07 MB, `/api/admin/patterns/recent` at 3.9 MB,
    `/api/delisted/list` at 1.68 MB, and the rest.

NOTHING HERE IS TYPED THAT COULD BE DERIVED
-------------------------------------------
  * the route table is `api.main:app`'s — the app the product actually serves,
    the same reason `test_admin_guard_registered.py` refuses to build its own;
  * every `(method, path)` in `GATED` is CHECKED to exist in that table, so a
    renamed or unmounted route empties this file LOUDLY instead of quietly (the
    `_fetch_naaim` failure shape: a guard whose list stopped matching the thing
    it guarded, and passed);
  * each route's gate is read off `route.dependant` BY OBJECT IDENTITY, never
    off the source text — a grep on this branch has already manufactured a
    ship-blocker from three prose hits and hidden a real one;
  * and the object-identity checker carries a CONTROL that proves it can say
    "ungated", so a checker that had stopped seeing anything cannot pass by
    finding a gate everywhere.

⭐ AND THE PAID HALF IS ASSERTED, BECAUSE A GATE THAT BLOCKS EVERYONE IS NOT A
FIX. Every safely-probeable route is driven a second time with a paid member and
must NOT answer a refusal — plus a control asserting that pass produced real
200s, so "not refused" cannot be satisfied by a router that 503s uniformly.

⛔ AND SOME ROUTES ARE DELIBERATELY NEVER PROBED.
`lesson_never_probe_a_mutating_endpoint_to_test_auth`: firing an unauthenticated
POST at a real mutating endpoint is safe only WHEN THE GATE WORKS — in the one
case this file exists to detect, the request is not refused and the handler RUNS.
This repo has already executed a real production job (8,108 contracts) that way,
and `POST /api/cot/reseed` is a TEN-YEAR CFTC re-download. Those routes are
verified STRUCTURALLY only, and `NEVER_PROBED` says which and why.

✋ WHAT IS DELIBERATELY *NOT* GATED, ASSERTED SO IT STAYS A DECISION
-------------------------------------------------------------------
`/api/rundown` and `/api/rundown/speech-text` are the FREE TIER
(`FREE_PAGES = ['/morning-wire']`). They are gated on `get_current_user`, not on
payment, and `test_the_FREE_TIER_still_reads_the_morning_wire` drives a free
member through them and requires 200. A paywall fix that closes the top of the
funnel is not a fix, and this is the assertion that would notice.
"""
from __future__ import annotations

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    PAID_PLANS,
    get_current_user,
    get_current_user_with_plan,
    require_admin,
    require_plan,
)

# ── the gate table ───────────────────────────────────────────────────────────
#
# ⛔ THE PATHS ARE A CLAIM, NOT THE MEASUREMENT. Each is checked against the
# derived route table below; the CLASS is checked against `route.dependant`.
#
# Classes:
#   "paid"       — the router's own `require_paid` (402 to a logged-in free member)
#   "admin"      — `require_admin` (403 to a non-admin)
#   "session"    — `get_current_user` only: a real account, no payment check.
#                  Used where the surface IS the free tier, or where the gate is
#                  about authorship rather than entitlement.
#   "flow_user"  — `require_flow_user`  (session OR `Bearer PUSH_SECRET`)
#   "flow_admin" — `require_flow_admin` (admin session OR `Bearer PUSH_SECRET`)
#
# ⚠️ The flow family uses its OWN gate deliberately: post-P5 those handlers run
# on FLOW-WORKER, which has no auth.db, so web validates the cookie in
# `flow_proxy._inject_proxy_auth` and vouches by HMAC. `require_paid` there would
# consult `get_user_plan` on a pod that cannot reach the users table.
GATED: dict[tuple[str, str], str] = {
    # ── P0: destructive / cost-bearing, was anonymous ────────────────────────
    ("POST", "/api/top-flow/purge-old/{keep_days}"): "flow_admin",
    ("POST", "/api/cot/reseed"): "admin",
    ("POST", "/api/cot/refresh"): "admin",
    ("POST", "/api/discord/push"): "flow_admin",
    ("POST", "/api/discord/push-image"): "flow_admin",
    ("POST", "/api/discord/watchlist-card"): "flow_admin",
    ("POST", "/api/watchlist/save"): "flow_admin",
    ("POST", "/api/theme-performance/refresh"): "admin",
    ("POST", "/api/backtest"): "paid",
    # ≤5-hundred-symbol on-demand scan (spec §5.5, lane W4a). GIL-bound
    # compute on the single web pod, so: paid, per-member rate-limited, one
    # run at a time, and QUEUED — the submit hands back a job id and the pool
    # thread does the work, which is why the POLL is claimed here too. A hit
    # list is the thing the toolkit sells; a gated submit beside an open read
    # would hand every result on this pod to whoever guessed a job id.
    # Probe-safe in both directions: the POST's body is required, so an
    # anonymous probe refuses before validation and a paid probe without a
    # body is 422; the GET's sample job id belongs to nobody, so a paid probe
    # is the ordinary 404. Nothing in this file ever evaluates a scan.
    ("POST", "/api/scans/run"): "paid",
    ("GET", "/api/scans/run/{job}"): "paid",
    # ── W4b.5's live-sweep reader. TWO ROUTES, TWO DIFFERENT CALLERS. ────────
    # `/api/scans/live-status` is the intraday sweeper's liveness beat (last
    # cycle receipt + how stale it is) and it is product surface: paid, like the
    # saved scans it reports on. `/api/scans/demand` hands the WORKER's prewarm
    # ring the demand list AND every symbol members have watchlisted or tagged —
    # member data, no member session, so it carries the PUSH_SECRET bearer and
    # admits no human account at all.
    # ⚠️ CLAIMED HERE BECAUSE THE MODULE-SCOPED RAIL IN
    # `tests/test_scan_live_sweep.py` WALKS `scan_live.py` ALONE. That rail
    # proves each route carries one of its own two gates; it says nothing about
    # the SERVED app, and this table plus the paid-surface ratchet is what does.
    ("GET", "/api/scans/live-status"): "paid",
    ("GET", "/api/scans/demand"): "worker",
    ("POST", "/api/admin/patterns/{detection_id}/review"): "admin",
    # ⚰️ CLAIMED "session" UNTIL 2026-08-26 AND THE APP HAS CARRIED `require_paid`
    # SINCE 2026-08-09. Corrected against the handler, not against this table:
    # `api/routers/patterns.py::post_feedback` takes `Depends(require_paid)` and
    # says why in-file — the row it writes lands in the corpus that trains the
    # engine, and the detections it grades are paid reads, so the write follows
    # the read. The stale claim was not inert: every "is this route paid" sweep
    # in this file keys off the CLASS, so a paid route filed under `session` was
    # silently excluded from `test_a_FREE_member_is_refused_on_the_PAID_routes`.
    ("POST", "/api/patterns/{detection_id}/feedback"): "paid",
    # ── P1: proprietary output, was anonymous ────────────────────────────────
    ("GET", "/api/flow/data"): "flow_user",
    ("GET", "/api/flow/indexes-data"): "flow_user",
    ("GET", "/api/flow/ticker/{symbol}"): "flow_user",
    ("GET", "/api/flow/stats"): "flow_user",
    ("GET", "/api/flow/version"): "flow_user",
    ("GET", "/api/flow/dates"): "flow_user",
    ("GET", "/api/flow/top-conviction"): "flow_user",
    ("GET", "/api/darkpool/data"): "flow_user",
    ("GET", "/api/darkpool/aggregated"): "flow_user",
    ("GET", "/api/darkpool/today"): "flow_user",
    ("GET", "/api/darkpool/dates"): "flow_user",
    ("GET", "/api/darkpool/version"): "flow_user",
    ("GET", "/api/darkpool/stats"): "flow_user",
    ("GET", "/api/darkpool/ticker-detail"): "flow_user",
    ("GET", "/api/top-flow/history"): "flow_user",
    ("GET", "/api/watchlist/dates"): "flow_user",
    ("GET", "/api/watchlist/load/{day}"): "flow_user",
    ("GET", "/api/admin/patterns/recent"): "admin",
    ("GET", "/api/admin/patterns/health"): "admin",
    ("GET", "/api/admin/disk-status"): "admin",
    ("GET", "/api/j2/compass-health"): "admin",
    ("GET", "/api/delisted/list"): "paid",
    ("GET", "/api/delisted/{sym}"): "paid",
    ("GET", "/api/patterns/{sym}"): "paid",
    ("GET", "/api/breadth"): "paid",
    ("GET", "/api/themes"): "paid",
    ("GET", "/api/leadership"): "paid",
    ("GET", "/api/uct20/portfolio"): "paid",
    ("GET", "/api/uct20/backtest"): "paid",
    ("GET", "/api/intraday-update"): "paid",
    ("GET", "/api/analyst-actions"): "paid",
    ("GET", "/api/groups"): "paid",
    ("GET", "/api/groups/peers"): "paid",
    ("GET", "/api/groups/{group_id}/top"): "paid",
    ("GET", "/api/rs-rankings"): "paid",
    ("GET", "/api/rs-rankings/{ticker}"): "paid",
    ("GET", "/api/breadth-monitor"): "paid",
    ("GET", "/api/breadth-monitor/latest"): "paid",
    ("GET", "/api/breadth-monitor/analogues"): "paid",
    ("GET", "/api/breadth-monitor/live"): "paid",
    ("GET", "/api/breadth-monitor/live/dividends"): "paid",
    ("GET", "/api/breadth-monitor/live/drill/{metric_key}"): "paid",
    ("GET", "/api/breadth-monitor/{date_str}/drill/{metric_key}"): "paid",
    ("POST", "/api/breadth/industries"): "paid",
    ("GET", "/api/breadth/industries/status"): "paid",
    ("GET", "/api/theme-performance"): "paid",
    ("GET", "/api/theme-rotation"): "paid",
    ("GET", "/api/cot/symbols"): "paid",
    ("GET", "/api/cot/status"): "paid",
    ("GET", "/api/cot/{symbol}"): "paid",
    # The archive of written weekly reads the rail shows when scrubbing back.
    # (`POST /api/cot/{symbol}/narrative` is paid too, but is deliberately NOT
    # probed here: a paid pass would generate a real model call.)
    ("GET", "/api/cot/{symbol}/narratives"): "paid",
    ("GET", "/api/sector-strength"): "paid",
    ("GET", "/api/regime"): "paid",
    ("GET", "/api/traders"): "paid",
    ("GET", "/api/insider/feed"): "paid",
    ("GET", "/api/insider/{ticker}"): "paid",
    ("GET", "/api/insider/{ticker}/has-buy"): "paid",
    ("GET", "/api/backtest/strategies"): "paid",
    # ── the free tier, gated on identity rather than payment ─────────────────
    ("GET", "/api/rundown"): "session",
    ("GET", "/api/rundown/speech-text"): "session",
}

#: ⛔ NEVER DRIVEN WITH A REQUEST, IN EITHER DIRECTION. Each takes no body and no
#: params, so an ungated handler would RUN on the probe rather than 422 — and
#: what it runs is a ten-year CFTC download, a full CFTC refresh, or a recompute
#: that pins the theme pool on the single web pod. Verified structurally instead.
#: `lesson_never_probe_a_mutating_endpoint_to_test_auth`.
NEVER_PROBED = {
    ("POST", "/api/cot/reseed"),
    ("POST", "/api/cot/refresh"),
    ("POST", "/api/theme-performance/refresh"),
}

#: Path-param samples, validated against what each route DECLARES so a new param
#: fails loudly instead of quietly 404-ing and turning an assertion into noise.
PATH_PARAM_SAMPLES = {
    "symbol": "GC",           # a real COT symbol; also fine as a flow ticker
    "sym": "NVDA",
    "ticker": "NVDA",
    "day": "2026-08-08",
    "date_str": "2026-08-08",
    "metric_key": "up_4pct_today_list",
    "group_id": "ai",
    "detection_id": "no-such-detection",
    # ⛔ A JOB ID THAT BELONGS TO NOBODY, ON PURPOSE. The run service answers
    # not-there and not-yours identically (404), so a probe with this cannot
    # read a real member's hits and cannot start any compute.
    "job": "no-such-job",
    # ⛔ NOT AN INTEGER, ON PURPOSE — see `test_the_destructive_purge_route…`.
    "keep_days": "not-an-int",
    # ── the factory-gated surface (section 9) ──────────────────────────
    # ⛔ IDS THAT BELONG TO NOBODY, ON PURPOSE. FOUR of those routes are a PUT
    # or a DELETE, and `lesson_never_probe_a_mutating_endpoint_to_test_auth` is
    # about exactly this: the probe is safe only WHILE the gate works. Two
    # independent things make it safe here — the refusal lands on the
    # dependency before any handler runs (asserted, with a spy, in section 9),
    # and every id below matches no record, so a handler that DID run would
    # find nothing to mutate.
    "broker_account_id": "no-such-broker-account",
    "flag_id": "no-such-dup-flag",
    "source_id": "no-such-note-source",
    # …and a REAL provider name. `{provider}` sits at the same depth as the
    # literal segment `sources`, so a placeholder like "x" is fine but the one
    # value that must never be used is `sources` itself — it would route the
    # probe at a different handler than the one being graded and the sweep
    # would report on a route it never touched.
    "provider": "roam",
}

#: Required query params, same self-policing rule.
QUERY_PARAM_SAMPLES = {"sym": "NVDA"}

#: Bodies for the routes that require one. Sent ONLY on the paid pass; the
#: refusal pass deliberately sends nothing, because dependencies are solved
#: before parameter validation — so a gated route refuses whatever it was sent,
#: while an UNGATED one answers 422 and is caught.
BODY_SAMPLES = {
    ("POST", "/api/breadth/industries"): {"tickers": ["NVDA"]},
}

REFUSALS = {401, 402, 403}

ANON = None
FREE_USER = {"id": "free-1", "email": "free@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "paid-1", "email": "paid@example.test", "role": "member", "plan": "pro"}
ADMIN_USER = {"id": "adm-1", "email": "adm@example.test", "role": "admin", "plan": "free"}


# ── the derived route table ──────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    """THE REAL APP. Imported, never rebuilt.

    ⛔ A locally-constructed `FastAPI()` is how `AdminGuardMiddleware` stayed
    green for months while production had no guard at all — both halves of a
    severed wire remain individually correct. Everything here reads the object
    `main.py` hands uvicorn.

    ⚠️ NOT used as a context manager: `TestClient.__enter__` runs the lifespan,
    which starts the scheduler, the COT seed and the bars prewarm. This file is
    about routing and dependencies, neither of which needs any of that running.
    """
    from api.main import app as real_app
    return real_app


def _http_routes(app):
    """Every mounted HTTP route. `getattr(r, "methods", None)` rather than an
    isinstance check: a Mount or a WebSocketRoute has no `methods`, and a type
    filter would name a FastAPI class this file would then have to track."""
    return [r for r in app.routes if getattr(r, "methods", None)]


def _table(app) -> dict[tuple[str, str], object]:
    out = {}
    for r in _http_routes(app):
        for method in sorted(r.methods - {"HEAD", "OPTIONS"}):
            out[(method, r.path)] = r
    return out


def _dep_names(route) -> set[str]:
    """Every dependency in the route's FULL tree, by `__name__` — a gate nested
    under another gate (`require_paid` -> `get_current_user_with_plan` ->
    `get_current_user`) is therefore counted."""
    names, stack = set(), list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        n = getattr(d.call, "__name__", None)
        if n:
            names.add(n)
        stack.extend(d.dependencies)
    return names


def _dep_objects(route) -> set:
    objs, stack = set(), list(route.dependant.dependencies)
    while stack:
        d = stack.pop()
        objs.add(d.call)
        stack.extend(d.dependencies)
    return objs


# ── door 3: a gate with NO NAME AT THE CALL SITE ─────────────────────────
#
# 🔴 `require_plan` IS A FACTORY. `broker_sync.py` and `note_sync.py` each call
# it ONCE at module scope — `_paid = require_plan(list(PAID_PLANS))` — so every use
# site reads `Depends(_paid)`: a local module variable, with no gate name in it,
# whose `__name__` is `"checker"`. Twelve member-facing routes carry it, and they
# are not small ones: refreshing broker accounts, editing and deleting broker
# connections, and creating, syncing, editing and deleting note sources.
#
# ⛔ THE `paid` RUNG MATCHED THE STRING `"require_paid"`, SO IT COULD NOT SEE ONE
# OF THEM. That is this file's THIRD blind spot of a single shape, reached through
# a third door:
#
#   * door 1 — a claim DOWNGRADE: a `paid` route re-filed as `session` (`505153a9f`);
#   * door 2 — a gate function ABSENT from the ladder (`require_push_secret`);
#   * door 3 — a gate with no name at the call site at all, which is the one that
#     cannot be fixed by adding a row to a table, because there is no name to add.
#
# ⭐ SO THE FACTORY IS ASKED WHAT ITS PRODUCT LOOKS LIKE, AND THE PRODUCT IS ASKED
# WHAT IT WAS BUILT WITH. Neither is typed here: the qualname comes from CALLING
# `require_plan` at import, and the plan list is read off the closure the factory
# closed over. Renaming the inner `checker` moves both at once instead of silently
# unhooking the reader — and a gate built with a plan list that admits a FREE
# member is refused a `paid` classification rather than being swept in with the
# rest, which `test_every_require_plan_gate_in_the_served_app_is_a_REAL_paid_check`
# then fails on BY NAME.
_PLAN_CHECKER_QUALNAME = require_plan([]).__qualname__


def _plan_gate_allows(dep) -> frozenset | None:
    """The plan set `dep` was BUILT with, or None if it is not a `require_plan`
    product.

    An EMPTY set means "it is one, and its plan list could not be read" — which
    section 9 fails on by name rather than reading as "this gate admits nobody",
    because a gate nobody can describe is not a gate anybody has checked.
    """
    if getattr(dep, "__qualname__", None) != _PLAN_CHECKER_QUALNAME:
        return None
    freevars = getattr(getattr(dep, "__code__", None), "co_freevars", ())
    for name, cell in zip(freevars, dep.__closure__ or ()):
        if name == "allowed_plans":
            try:
                return frozenset(cell.cell_contents)
            except (TypeError, ValueError):
                return frozenset()
    return frozenset()


def _plan_gates(objs) -> set:
    """Every `require_plan(...)` product in a set of dependency objects."""
    return {d for d in objs if _plan_gate_allows(d) is not None}


def _is_paid_plan_gated(objs) -> bool:
    """True when one of these dependencies was built by `require_plan` with a
    plan list that admits PAID PLANS ONLY — the same door `require_paid` opens,
    reached through a factory."""
    return any(bool(allowed) and allowed <= PAID_PLANS
               for allowed in (_plan_gate_allows(d) for d in objs))


# ── the gate ladder: ONE declaration, read two ways ──────────────────────────
#
# ⭐ THE CLASS VOCABULARY IS WRITTEN HERE AND NOWHERE ELSE. `_klass_of` is BUILT
# from this tuple, and the strength comparison READS it — so "what a route can
# report" and "what a row may claim" are the same list by construction. A second
# hand-typed copy of these names is how a claim and the check on it drift apart
# (`lesson_a_second_authority_over_one_value`, this repo's most repeated defect).
#
# ⛔ AND THE ORDER IS NOT AN OPINION. Strength here means WHO THE GATE LETS IN,
# spelled in the three callers this file already declares: a gate that admits
# fewer of them is stronger. `test_the_gate_ladder_MEASURES_who_each_gate_admits`
# CALLS the real gate objects and fails if any row below disagrees with what the
# running app does — so this cannot quietly become a typed lie about the doors.
#
# The two `flow_*` classes are the flow family's own mirror of the same two
# doors (`require_flow_user` = any real account, `require_flow_admin` = an
# operator). They are deliberately EQUAL in strength to their non-flow twins
# rather than ranked above or below them: inventing an order between two gates
# nobody has compared is exactly the fiction this comment is warning about.
_GATE_LADDER: tuple[tuple[str, object, frozenset], ...] = (
    # class          how the SERVED APP reports it            who the gate admits
    ("session",    lambda n, o: get_current_user in o,     frozenset({"free", "paid", "admin"})),
    ("flow_user",  lambda n, o: "require_flow_user" in n,  frozenset({"free", "paid", "admin"})),
    # ⭐ TWO SPELLINGS, ONE RUNG — AND THEY WERE COMPARED RATHER THAN ASSUMED
    # ALIKE. `require_paid` is a per-router FUNCTION; a `require_plan(list(
    # PAID_PLANS))` product is the same door reached through a FACTORY, with no
    # name at the call site (see `_plan_gate_allows` above). Over the THREE CALLERS
    # THIS FILE DECLARES — free, paid, admin — both families admit exactly
    # {paid, admin}, measured by `test_the_gate_ladder_MEASURES_who_each_gate_
    # admits`, which now calls BOTH. That is what makes this ONE rung a finding
    # rather than a resemblance, and it is the whole basis of the ranking.
    #
    # ⛔⛔ BUT THEY ARE NOT THE SAME CHECK, AND THE RUNG MUST NOT BE READ AS SAYING
    # SO. MEASURED 2026-08-26, directly, on the objects the app serves:
    #
    #     plan == "comped"  →  `require_plan` ADMITS  (both products; the factory
    #                          in `auth_middleware.py` tests `plan == "comped"`
    #                          explicitly, beside the allowed-plans membership)
    #                       →  `require_paid`  REFUSES 402  (all 38 copies)
    #
    # A comped account therefore reaches every brokerage- and note-connector route
    # and is turned away from all 187 other paid surfaces. `comped` is a REAL plan
    # value in this product, not a test fixture — so this is a live disagreement
    # about a member's access, and which family is right is a PRODUCT DECISION that
    # has been escalated. ⛔ IT IS DELIBERATELY NOT RECONCILED HERE: quietly making
    # one family match the other would decide that question in a test file.
    #
    # ⚠️ The rung's admit-set stays honest because `comped` is not one of this
    # file's three declared callers — the ladder ranks what it measures. What was
    # dishonest was the sentence above claiming the two were the same check. It is
    # pinned by `test_the_two_paid_gate_families_DISAGREE_about_comped`, so if the
    # disagreement is ever resolved — in either direction — that test goes red and
    # this paragraph has to be rewritten instead of quietly becoming false.
    ("paid",       lambda n, o: "require_paid" in n or _is_paid_plan_gated(o),
                                                           frozenset({"paid", "admin"})),
    ("flow_admin", lambda n, o: "require_flow_admin" in n, frozenset({"admin"})),
    ("admin",      lambda n, o: require_admin in o,        frozenset({"admin"})),
    # ⭐ 2026-08-26 — THE MACHINE DOOR, AND IT ADMITS NO HUMAN ACCOUNT AT ALL.
    # `require_push_secret` checks a shared bearer and never looks at a user, so
    # of this file's three declared callers it admits NONE — an empty admit-set,
    # which makes it a PROPER SUBSET of `admin` and therefore the strongest rung
    # on the ladder. That is not a flourish: it is what stops a `worker` row
    # being satisfiable by an admin gate, or vice versa.
    #
    # 🔴 WHY IT HAD TO EXIST BEFORE `/api/scans/demand` COULD BE CLAIMED AT ALL:
    # the vocabulary had no word for a bearer-only route, so `_klass_of` reported
    # NOTHING for one and no claim could ever be satisfied. Every PUSH_SECRET
    # surface in the app was therefore UNCLAIMABLE and sat outside this audit by
    # construction — silently, because an unclaimed route is simply absent from
    # `GATED` and nothing counts the absence.
    #
    # ⛔⛔ AND THIS RUNG DOES NOT COVER THAT CLASS. READ THIS BEFORE ASSUMING IT
    # DOES. `_klass_of` reads the DEPENDENCY TREE, so a route reports `worker`
    # only if it carries the check as a NAMED `Depends`. Measured 2026-08-26 by
    # AST over `api/routers/*.py` (a handler counts as gated if it, or a
    # module-level helper it calls, names the string `PUSH_SECRET`):
    #
    #     38 PUSH_SECRET-gated routes
    #      9 carry it as a `Depends`  -> claimable, and now report `worker`
    #        (`scan_live.demand` + 8 in `education.py`)
    #     29 gate INLINE in the handler body -> STILL UNCLAIMABLE
    #        (desk_zoom_webhook 14, cot 3, push 3, calendar 2, note_sync 2,
    #         broker_sync/catalysts/massive_stream_router/wire/wire_feedback 1 each)
    #
    # ⚠️ The re-review counted 55/9/46 on a wider scope; the 9 agrees EXACTLY and
    # the disagreement is only in what counts as "a PUSH_SECRET route". Either
    # number says the same thing: the majority of this family remains outside the
    # audit, and this rung is the PRECEDENT for pulling them in — not the fix.
    # Doing so means converting an inline check into a `Depends`, which changes
    # those routes' behaviour and is an owner decision, not a test edit.
    #
    # 🔴 NOR IS PUSH_SECRET THE ONLY FAMILY MISSING FROM THIS LADDER. A sweep
    # prompted by this rung found four more gate functions absent from it —
    # `requires_voice_access`, `require_community`, `require_chat` and
    # `require_plan(...)`, all of which raise 402/403 on a real plan check yet
    # report only `session`, so a `session` claim satisfies them and a downgrade
    # is invisible — plus `require_article_reader`, which reports NOTHING AT ALL,
    # exactly the shape this rung was added to fix. That is owner ruling O11.
    #
    # ⚠️ THIS PARAGRAPH USED TO CARRY A TOTAL OF "~129 ROUTES" AND IT WAS WRONG,
    # by the most ordinary arithmetic there is: THE FAMILIES OVERLAP. Every one of
    # `require_chat`'s routes nests `require_community`, so adding those two counts
    # billed 21 routes twice — and the same total still included the 12
    # `require_plan` routes this rung has since CLOSED. Both errors point the same
    # way: a per-family count is a SET, and only a union may be summed. The
    # corrected figure, and how it was derived, is one paragraph down.
    #
    # ✅ ONE OF THE FIVE IS NOW CLOSED (W9d.1, 2026-08-26): `require_plan(...)`
    # — the 12 broker/note-sync routes — reports `paid` through the `paid` rung
    # above, is counted by `PAID_SURFACE_FLOOR`, and is driven with a free member
    # in section 9. It was the hardest of the five and the reason is worth
    # keeping: the other four are FUNCTIONS with names a table can hold, and this
    # one had no name at the call site at all.
    #
    # ⛔ THE OTHER FOUR ARE STILL BLIND: 96 ROUTES, AND THE 96 IS A UNION.
    # MEASURED 2026-08-26 off `api.main:app` by walking each route's FULL dependant
    # tree, collecting a `(method, path)` SET per family, and unioning them — never
    # by adding the four numbers up:
    #
    #     requires_voice_access   54    disjoint from all three others
    #     require_community       37    CONTAINS every `require_chat` route
    #       …of which require_chat 21   `chat - community` is EMPTY, measured
    #     require_article_reader   5    disjoint from all three others
    #     ---------------------------------------------------------------------
    #     union                   96    = 54 + 37 + 5; chat contributes 0 NEW
    #
    # (`api/routers/community.py` declares 48 routes: 16 community-only, 21 chat,
    # 10 `require_admin`, 1 `get_current_user` — which is where the nesting is
    # visible inside a single file.)
    #
    # ⚠️ 117 WAS WRITTEN HERE FIRST, AND IT WAS 54+37+21+5 — the same double-count
    # the paragraph above made, one family shorter. THREE separate readings of this
    # file produced a wrong total before anybody unioned the sets. Do not re-derive
    # this by adding; re-derive it by walking the routers, or leave it alone.
    #
    # 96 routes whose real entitlement check this ladder still cannot report, so a
    # `session` claim would satisfy any of them. Closing each one is the same
    # two-line move made here (a rung predicate + an admit-set measured in
    # `test_the_gate_ladder_MEASURES_who_each_gate_admits`) and it is owner ruling
    # O11, not a test edit to make quietly: it changes what claims those routes
    # can carry. ⭐ A census that NAMES its blind spots is the fix; one that looks
    # complete is the defect — which is why this paragraph gets shorter by one
    # family at a time and never disappears.
    ("worker",     lambda n, o: "require_push_secret" in n, frozenset()),
)

#: Derived off the ladder, never retyped beside it.
GATE_CLASSES = frozenset(klass for klass, _, _ in _GATE_LADDER)
_ADMITS: dict[str, frozenset] = {klass: adm for klass, _, adm in _GATE_LADDER}


def _klass_of(route) -> set[str]:
    """The classes this route satisfies, by IDENTITY where identity is shared.

    `require_paid` is defined per router (the repo's shipped pattern, railed by
    `tests/test_user_definitions_auth.py`), so there is no single object to
    compare against — for that one class the name is the identity, and
    `test_every_require_paid_gate_is_a_REAL_paid_check` proves each such function
    actually consults `is_paid_user` rather than merely being called that.

    ⚠️ THIS RETURNS EVERY CLASS THE ROUTE SATISFIES, NOT ITS GATE. `require_paid`
    nests `get_current_user`, so a paid route reports `session` as well — which
    is true, and is precisely why a claim may not be checked with `in`. See
    `_claim_is_satisfied`.
    """
    names, objs = _dep_names(route), _dep_objects(route)
    return {klass for klass, reports, _ in _GATE_LADDER if reports(names, objs)}


def _strongest(found: set[str]) -> set[str]:
    """The strongest classes in `found` — the ones nothing else in `found` is
    strictly stronger than.

    ⛔ RANKED BY SUBSET, NOT BY SIZE. "Admits fewer callers" only means
    "is stronger" while the admit-sets nest, which they happen to do today. Two
    classes admitting the same NUMBER of DIFFERENT callers would read as equal
    under a size comparison and one of them could then stand in for the other —
    the same substitution this whole file exists to refuse, wearing arithmetic.
    `_ADMITS[j] < _ADMITS[k]` is a PROPER SUBSET: everyone `j` lets in, `k` lets
    in too, and `k` lets in somebody more. That is what "j is stronger" means.

    Returns a SET, not a winner. Two classes can be genuinely equal (`admin` and
    `flow_admin` are one door reached two ways) or simply incomparable, and
    breaking that tie would be an ordering nobody measured. An ungated route
    falls out of this with no strongest class at all.
    """
    return {klass for klass in found
            if not any(_ADMITS[other] < _ADMITS[klass] for other in found)}


def _closed_to_paid() -> set:
    """The `GATED` rows whose CLASS does not admit a paid member — derived off
    `_ADMITS`, never listed.

    ⛔ THIS REPLACES A HAND-TYPED `("admin", "flow_admin")` THAT APPEARED TWICE.
    The paid sweep below exists to prove a gate is not an OUTAGE, and it must
    obviously skip doors a paid member is not supposed to open. Spelling those
    doors as two class NAMES made the skip list a second authority over the
    ladder: adding a class the ladder says admits nobody (`worker`, 2026-08-26)
    left it out of the tuple, and the sweep would then have demanded that a paid
    member get through a machine-only door and gone red for being right.

    Reading `_ADMITS` instead means a new rung is skipped or swept according to
    what it actually admits, with no edit here — and `session`/`paid`/`flow_user`
    keep being swept because they really do admit a paid member.
    """
    return {k for k, klass in GATED.items() if "paid" not in _ADMITS[klass]}


def _claim_is_satisfied(expected: str, found: set[str]) -> bool:
    """⭐ A ROW'S CLAIM MUST NAME THE STRONGEST GATE ITS ROUTE CARRIES.

    ⛔ `expected in found` IS NOT ENOUGH, AND THAT IS THE BUG THIS REPLACES.
    `_klass_of` reports every class a route satisfies and `require_paid` nests
    `get_current_user`, so every paid route also reports `session`. A "paid"
    claim rewritten to "session" was therefore satisfied by the weaker gate
    sitting underneath it, and the door could then be opened with the audit
    still green. Measured, 2026-08-26 — both mutations passed; the controls in
    section 2b are that reproduction, kept.

    Equality against the strongest class forbids both directions at once:

      * a claim can never be met by a WEAKER gate than it names — the security
        half, and the one the whole file exists for;
      * and a claim can never UNDERSTATE the gate the app really carries, which
        is what makes the DOWNGRADE ITSELF go red, rather than the deletion that
        would follow it. Catching only the deletion is too late: the downgrade
        is the commit that makes the deletion invisible.

    It is deliberately NOT "expected == the one strongest class": equal-strength
    classes exist (see `_strongest`), and either name is an honest claim.
    """
    return expected in _strongest(found)


def _request_for(route, key, *, with_body: bool):
    method, path = key
    import re
    declared = set(re.findall(r"\{(\w+)\}", path))
    missing = declared - set(PATH_PARAM_SAMPLES)
    assert not missing, (
        f"{method} {path} declares path params {sorted(missing)} with no sample — "
        "add them to PATH_PARAM_SAMPLES or the sweep silently 404s instead of "
        "measuring the gate")
    url = path
    for name in declared:
        url = url.replace("{" + name + "}", str(PATH_PARAM_SAMPLES[name]))

    params = {}
    for field in route.dependant.query_params:
        if not field.required:
            continue
        assert field.name in QUERY_PARAM_SAMPLES, (
            f"{method} {path} requires query param {field.name!r} with no sample")
        params[field.name] = QUERY_PARAM_SAMPLES[field.name]

    kwargs = {"params": params} if params else {}
    if with_body and key in BODY_SAMPLES:
        kwargs["json"] = BODY_SAMPLES[key]
    return url, kwargs


def _client(app, user, monkeypatch=None):
    """A client for one caller.

    ⚠️ THE OVERRIDES ARE ON `get_current_user` / `get_current_user_with_plan`,
    NEVER on `require_paid` / `require_admin` themselves. Overriding a gate means
    the test never runs the gate — the injected-dependency vacuity
    `lesson_injected_dependency_hides_the_fetch` names. `user=None` overrides
    NOTHING, so an anonymous caller walks the real cookie path.

    The flow family does not use those dependencies: it reads the cookie itself
    through `api.flow_admin_auth.validate_session`, which is a `from` import, so
    the patch has to land on `flow_admin_auth`'s own name (a patch on
    `auth_service` would reach nothing — `lesson_from_import_severs_a_module_
    from_its_guards`). It is only applied for a signed-in caller; anonymous sends
    no cookie and the real function returns None on its own.
    """
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        if monkeypatch is not None:
            import api.flow_admin_auth as fa
            monkeypatch.setattr(fa, "validate_session", lambda _c: dict(user))
    # ⛔ `raise_server_exceptions=False` IS DELIBERATE AND IT IS NOT LENIENCY.
    # This file measures ONE thing: did the gate refuse this caller. A handler
    # that throws because a store is absent on a dev box (`no such table:
    # cot_refresh_log`) would otherwise re-raise INTO the test and fail it for a
    # DATA reason — and the fix someone reaches for then is to weaken the sweep.
    # As a 500 response it is simply "not a refusal", which is exactly true, and
    # `test_the_paid_pass_produces_REAL_successes…` is what stops a wall of 500s
    # from satisfying the paid half.
    client = TestClient(app, raise_server_exceptions=False)
    if user is not None:
        client.cookies.set("uct_session", "test-session")
    return client


@pytest.fixture
def clean_overrides(app):
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


# ── 1. the table is real ─────────────────────────────────────────────────────

def test_every_route_this_file_claims_to_have_gated_EXISTS_on_the_real_app(app):
    """⛔ THE LIST IS A CLAIM; THE APP IS THE MEASUREMENT.

    A gate table that names routes the app no longer mounts is the failure mode
    that lets a whole file pass while guarding nothing — the `_fetch_naaim`
    shape, where a guard's list stopped matching the thing it guarded and stayed
    green. So every key is resolved against `api.main:app`'s own table, and the
    table is asserted non-trivial so a broken walk cannot pass by finding zero.
    """
    table = _table(app)
    assert len(table) > 500, f"the route walk found only {len(table)} routes"
    missing = sorted(k for k in GATED if k not in table)
    assert not missing, (
        f"{missing} are named as gated but no such route is mounted — either a "
        "route was renamed (update this table WITH the rename) or a router "
        "stopped mounting, which is a bigger problem than the gate")


def test_the_gate_reader_can_report_UNGATED(app):
    """⭐ THE CONTROL ON THE CHECKER ITSELF.

    Every structural assertion below is "this route carries this gate". A reader
    that had stopped seeing dependencies — or one that returned every class for
    everything — would satisfy all of them. So: a route known to be deliberately
    open must come back with NO class at all.

    `GET /api/health` is Railway's `healthcheckPath`; it is public by design and
    will stay that way, which is what makes it a stable control.
    """
    table = _table(app)
    health = table[("GET", "/api/health")]
    assert _klass_of(health) == set(), (
        "the deliberately-public health check reports a gate — the class reader "
        "is returning classes it did not find")


# ── 2. the structural half ───────────────────────────────────────────────────

@pytest.mark.parametrize("key", sorted(GATED), ids=lambda k: f"{k[0]} {k[1]}")
def test_every_gated_route_carries_its_gate_in_the_DEPENDENCY_TREE(app, key):
    """Read off `route.dependant`, never off the source text.

    ⛔ AN AST OR A GREP WOULD BE A DIFFERENT ARTIFACT. A decorator on the wrong
    router object, a handler defined but never mounted, a router-level dependency
    someone hoisted — the source says one thing and the served app another. This
    reads the served app.
    """
    route = _table(app)[key]
    expected = GATED[key]
    found = _klass_of(route)
    strongest = _strongest(found)

    # ⛔ THE TWO FAILURES ARE DIFFERENT FACTS AND THE FIX IS DIFFERENT, so they
    # are told apart here. A red that reads ambiguously gets "fixed" by editing
    # the claim to match whatever the app now does — which, in the OPEN case, is
    # the regression signing its own permission slip.
    if not _claim_is_satisfied(expected, found):
        if not strongest:
            raise AssertionError(
                f"{key[0]} {key[1]} was gated as {expected!r} and the app "
                "reports NO GATE AT ALL — this route is open again. Restore the "
                "gate; do NOT relabel the row.")
        weaker = all(_ADMITS[expected] < _ADMITS[k] for k in strongest)
        raise AssertionError(
            f"{key[0]} {key[1]} was gated as {expected!r} and the strongest gate "
            f"the app actually carries is {sorted(strongest)} "
            f"(it reports {sorted(found)}).\n"
            + ("⚠️ THE ROUTE IS WEAKER THAN ITS CLAIM — the gate this row "
               "promises is gone and something more permissive is standing in "
               "for it. Restore the gate. Do NOT relabel the row to match: that "
               "is the regression writing its own permission slip.\n"
               if weaker else
               "⚠️ THE ROW UNDERSTATES THE ROUTE — the app enforces MORE than "
               "this table claims. Harmless to a caller today, and not harmless "
               "here: every sweep in this file selects rows BY CLASS, so a paid "
               "route filed as 'session' is quietly dropped from the free-member "
               "refusal check. Correct the row UPWARD to what the handler does.\n"))


# ── 2b. ⭐ THE CONTROL ON THE STRUCTURAL ASSERTION ITSELF ────────────────────
#
# 🔴 MEASURED, 2026-08-26 — the defect these two exist to make impossible.
# The assertion above used to read `expected in found`, and `_klass_of` returns
# EVERY class a route satisfies. A `paid` route also satisfies `session`, so:
#
#   1. edit `POST /api/scans/run`'s claim from "paid" to "session" → 90 passed;
#   2. THEN delete `require_paid` from the handler as well          → 90 passed.
#
# Restoring the claim proved the door had genuinely opened: a free member got
# 422, not 402. A paid, member-facing route could be made free-reachable and the
# repo's standing gate audit could not tell. The two tests below are that
# reproduction, kept — one for each half, because a test that only catches the
# TABLE edit does not catch the half that opens the door.

def test_a_DOWNGRADED_CLAIM_cannot_be_satisfied_by_the_weaker_gate_underneath(app):
    """🔴 HALF ONE: the table edit.

    `require_paid` nests `get_current_user`, so every paid route also reports
    `session` — which is exactly what let a "paid" claim be quietly rewritten to
    "session" and stay green. A claim must name the STRONGEST gate the route
    carries, so the weaker class sitting underneath can never stand in for it.

    ⛔ DERIVED, never typed: the route is whichever paid row actually reports
    both classes, so a rename cannot turn this into a test of nothing.
    """
    table = _table(app)
    both = [k for k, v in sorted(GATED.items())
            if v == "paid" and {"paid", "session"} <= _klass_of(table[k])]
    assert both, (
        "no paid row reports `session` underneath its `paid` — the nesting this "
        "test exists to defend against has changed shape; re-derive it")

    for key in both:
        found = _klass_of(table[key])
        assert _claim_is_satisfied("paid", found), (
            f"{key} carries paid and the honest claim was rejected: {sorted(found)}")
        assert not _claim_is_satisfied("session", found), (
            f"{key[0]} {key[1]} reports {sorted(found)} and a claim of 'session' "
            "was ACCEPTED — a paid route can be downgraded to session in this "
            "table and the audit stays green. That is the whole defect.")


def test_DELETING_require_paid_FROM_A_HANDLER_reds_the_row_that_claims_paid(app):
    """🔴 HALF TWO, AND THE ONE THAT MATTERS — the door, not the label.

    A table edit is a diff a human can see in review. This is the mutation that
    actually opens the route: `require_paid` is stripped off the SERVED app's
    own `route.dependant` — the same object the assertion reads — while the row
    still claims `paid`. EVERY paid row is cut in turn, not one sampled name, so
    a router that grew a different gate shape cannot slip past.

    ⭐ AND ITS NON-VACUITY CONTROL IS UNCONDITIONAL, BY CONSTRUCTION. On many
    routes the cut leaves nothing behind, and "NO GATE AT ALL" would fail any
    check ever written — so a version of this test that only ever saw that shape
    would prove almost nothing. The dangerous shape is the other one: a sibling
    dependency still resolves the session, so the route stays perfectly reachable
    by any free account and merely stops being PAID.

    ⛔ THAT CONTROL USED TO BE `assert still_reachable`, AND IT WAS INCIDENTAL.
    It passed only because `POST /api/scans/run` happens to keep a rate-limit
    dependency — measured, 1 of 43 paid routes — so a change to that ONE route's
    dependencies would have quietly emptied it. It is now asserted directly
    against the ladder instead: a `paid` claim is refused by EVERY class weaker
    than paid and by nothing at all, whether or not any route happens to be
    shaped that way today.

    ⚠️ RESTORED IN A `finally`, AND THE RESTORE IS ASSERTED. The `app` fixture is
    module-scoped: a leaked mutation would poison every assertion after this one,
    and a silent restore failure would read as a pass.
    """
    table = _table(app)
    cut_anything = []

    for key, expected in sorted(GATED.items()):
        if expected != "paid":
            continue
        route = table[key]
        idx = next((i for i, d in enumerate(route.dependant.dependencies)
                    if getattr(d.call, "__name__", "") == "require_paid"), None)
        if idx is None:
            continue
        original = list(route.dependant.dependencies)
        try:
            route.dependant.dependencies = [d for j, d in enumerate(original) if j != idx]
            opened = _klass_of(route)
            assert not _claim_is_satisfied("paid", opened), (
                f"{key[0]} {key[1]} had `require_paid` DELETED from its handler "
                f"and the app now reports {sorted(opened) or 'NO GATE AT ALL'} — "
                "yet the row still claiming 'paid' was satisfied. A paid, "
                "member-facing route can be opened to any free registration and "
                "this audit does not notice. That is the whole point of the file.")
        finally:
            route.dependant.dependencies = original

        assert _claim_is_satisfied("paid", _klass_of(route)), (
            f"{key[0]} {key[1]} did not come back after the mutation — every "
            "assertion after this one is running against a damaged app")

        cut_anything.append(key)

    assert len(cut_anything) >= 8, (
        f"only {len(cut_anything)} paid rows carry `require_paid` as a direct "
        "dependency — the walk is not reaching the gates it claims to cut")

    # ⭐ THE CONTROL, DERIVED FROM THE LADDER AND ALWAYS ARMED. Every class the
    # ladder ranks below `paid` must fail to satisfy a `paid` claim on its own,
    # and so must an empty gate set. Derived, so a class added to the ladder
    # joins this automatically rather than being remembered into it.
    weaker_than_paid = {k for k in GATE_CLASSES if _ADMITS["paid"] < _ADMITS[k]}
    assert weaker_than_paid, (
        "the ladder ranks nothing below `paid`, so 'a paid claim cannot be met "
        "by something weaker' is currently unfalsifiable — re-derive the ladder")
    for klass in sorted(weaker_than_paid):
        assert not _claim_is_satisfied("paid", {klass}), (
            f"a route reporting only {klass!r} satisfied a claim of 'paid'. That "
            "is the cut above surviving on a sibling dependency: the door is "
            "open to anyone that gate admits and the row still says paid.")
    assert not _claim_is_satisfied("paid", set()), (
        "a route reporting NO GATE AT ALL satisfied a claim of 'paid'")


#: 🔴 THE PAID SURFACE OF THE SERVED APP, PINNED. Measured 2026-08-26:
#: 174 of the 1,130 routes that expose a dependency tree carry `require_paid`.
#: This is a RATCHET, not a fact about the table — see the test below for the
#: only two correct responses to it going red.
#:
#: ⭐ RAISED 174 → 187 (W9d.1, 2026-08-26) — AND THAT IS THE POINT OF THE FIX,
#: not a side effect of it. The `paid` rung can now see the 12 routes gated by
#: `require_plan(list(PAID_PLANS))`, so deleting `_paid` from `broker_sync.py`
#: or `note_sync.py` drops this count by 6 and reds this ratchet. Before today
#: that deletion moved NO number in this file at all.
#:
#: ⛔ 187 IS THE MEASURED COUNT, WITH NO SLACK, AND THE SLACK WAS THE WHOLE
#: QUESTION. This was briefly set to 186 (the old 174 plus the 12 newly-visible
#: routes) to avoid pinning a route another lane had landed the same night. That
#: is ONE route of slack — and one route of slack is exactly the amount that
#: stops a SINGLE-ROUTE DELETION from reding this ratchet, which is the most
#: likely regression there is. A ratchet with room in it is not a ratchet.
#: Re-measured 2026-08-26: 175 `require_paid` + 12 `require_plan(PAID_PLANS)`,
#: overlap 0, union 187.
PAID_SURFACE_FLOOR = 187


def test_the_PAID_SURFACE_of_the_served_app_has_not_SHRUNK(app):
    """🔴 THE DETECTOR FOR THE TWO-STEP EDIT, AND THE ONLY SHAPE THAT CAN BE ONE.

    Every other assertion in this file compares the TABLE to the APP — which is
    exactly what a two-step edit defeats. Downgrade the claim and delete the gate
    in ONE commit and the table is TRUTHFUL about a now-weaker route, so no
    table-vs-app check has anything to object to. MEASURED, 2026-08-26: the full
    two-step on `POST /api/scans/run` leaves
    `test_a_FREE_member_is_refused_on_the_PAID_routes` PASSING, because every
    sweep here selects rows BY CLASS and the row is no longer `paid`.

    ⭐ SO THIS ONE NEVER READS THE TABLE. It counts the routes the SERVED APP
    reports as `paid` — EITHER SPELLING: `require_paid`, or a
    `require_plan(list(PAID_PLANS))` product — and refuses to let that number
    fall. No claim can satisfy it because no claim is consulted: only a real gate
    on a real route counts, and removing one is arithmetic. It therefore covers
    all 187 paid routes, not just the 43 this file governs — the 144 that were
    never in the table get the same ratchet for free.

    ⚠️ IT READS `_klass_of`, SO IT INHERITS THE RUNG, AND THE PROSE HERE HAS TO
    KEEP UP WITH IT. This docstring and the failure message below both said
    "`require_paid`" for one commit after the rung stopped meaning that — a number
    in prose that the code no longer means, which is how the wrong total in the
    ladder comment above got written and re-inherited. If a future gate family
    joins the rung, raise this floor in the same commit: the number moving up is
    the receipt that the new family is really being counted.

    ⚠️ IT IS A RATCHET AND THE NUMBER IS THE WHOLE MECHANISM. Adding paid
    routes raises the count and passes. There are exactly two correct responses
    to it going red:
      * a gate was lost — RESTORE IT; or
      * a paid route was retired ON PURPOSE — lower this floor IN THE SAME COMMIT
        and name the route in the message.
    That second edit is a visible line saying "the paid surface shrank", which is
    the one sentence a two-step edit exists to avoid having to write. Lowering
    the floor to make a red go away, without knowing which route left, IS the
    door opening — it is not a fix, it is the regression being waved through.

    ⚠️ NOT EVERY MOUNTED ROUTE HAS A DEPENDENCY TREE. `/openapi.json`, `/docs`
    and the swagger assets are plain Starlette `Route`s with no `.dependant` at
    all, so they are filtered rather than crashed on — and the survivors are
    floored too, because a walk that started returning nothing would otherwise
    make the paid count zero and this assertion loud for the wrong reason.
    """
    routed = [r for r in _table(app).values()
              if getattr(r, "dependant", None) is not None]
    assert len(routed) >= 1000, (
        f"only {len(routed)} routes expose a dependency tree — the walk is broken "
        "and any count taken from it below would be meaningless")

    paid = sorted(k for k, r in _table(app).items()
                  if getattr(r, "dependant", None) is not None
                  and "paid" in _klass_of(r))
    assert len(paid) >= PAID_SURFACE_FLOOR, (
        f"the served app reports {len(paid)} routes as `paid` (either spelling: "
        f"`require_paid`, or a `require_plan(list(PAID_PLANS))` product); the "
        f"floor is {PAID_SURFACE_FLOOR}. {PAID_SURFACE_FLOOR - len(paid)} paid "
        "route(s) stopped being paid. Restore the gate — or, if one was retired "
        "on purpose, lower this floor in the same commit and NAME the route. Do "
        "not lower it to clear the red: that is the two-step edit finishing.")


def test_a_LEGITIMATELY_session_gated_route_still_passes(app):
    """…and the strength rule is not simply "reject more".

    The free tier is gated on identity, not payment, ON PURPOSE. A rule that
    made `session` unclaimable would be satisfied by closing the top of the
    funnel — so the rows that really are session-only must still pass, and the
    control is that they carry `session` and nothing stronger.
    """
    table = _table(app)
    session_rows = [k for k, v in sorted(GATED.items()) if v == "session"]
    # ⚠️ A FLOOR, BECAUSE THIS FILE'S OWN FIX MOVED THE NUMBER. Correcting the
    # patterns-feedback row took `session` from 3 rows to 2, and a control that
    # shrinks quietly ends up guarding nothing. These two ARE the free tier
    # (`FREE_PAGES = ['/morning-wire']`); if either stops being session-gated
    # that is a funnel decision, not a number to lower.
    assert len(session_rows) >= 2, (
        f"only {len(session_rows)} session-gated rows left ({session_rows}) — the "
        "free tier is two routes, and this control is meant to hold both")
    for key in session_rows:
        found = _klass_of(table[key])
        assert _claim_is_satisfied("session", found), (
            f"{key[0]} {key[1]} claims 'session' and reports {sorted(found)} — "
            "a legitimately session-gated route was rejected")


def test_the_gate_ladder_MEASURES_who_each_gate_admits(app, monkeypatch):
    """⭐ THE CONTROL ON THE STRENGTH ORDER, SO IT IS NOT A TYPED OPINION.

    `_GATE_LADDER` ranks a class by who its gate lets in. That is a claim about
    RUNNING CODE, and a strength table nobody checked is just a comment that the
    whole audit now leans on — so each gate object is CALLED with this file's
    three declared callers, and the admitted set must be exactly what the ladder
    says. Get this wrong and every row ranked against it rests on a wrong number
    while reading as measured.

    ⚠️ FOUR OF THE FIVE ARE CALLED HERE, AND SAYING WHICH IS THE POINT.
    `get_current_user` takes a `Request` and reads a cookie, so `session`'s
    breadth is not callable in this shape; it is measured BEHAVIOURALLY instead —
    `test_the_FREE_TIER_still_reads_the_morning_wire` drives a free member
    through a session-gated route and requires 200, and the paid sweep covers
    the rest. An unmeasured row quietly skipped inside a table like this one
    reads exactly like a measured one, which is why it is named rather than
    omitted (`lesson_a_green_suite_does_not_mean_a_true_number`).
    """
    from fastapi import HTTPException
    import api.flow_admin_auth as fa

    callers = {"free": FREE_USER, "paid": PAID_USER, "admin": ADMIN_USER}
    measured: dict[str, set[str]] = {}

    def _admits(invoke) -> set[str]:
        out = set()
        for name, user in callers.items():
            try:
                if invoke(user) is not None:
                    out.add(name)
            except HTTPException:
                pass
        return out

    # `require_admin` is ONE shared object — identity, so call it directly.
    measured["admin"] = _admits(lambda u: require_admin(dict(u)))

    # `require_paid` is defined PER ROUTER by design, so every copy reachable
    # from a paid row is measured and they must all admit the same callers —
    # one router quietly admitting free members is the shape this catches.
    paid_gates = {d for key, klass in GATED.items() if klass == "paid"
                  for d in _dep_objects(_table(app)[key])
                  if getattr(d, "__name__", "") == "require_paid"}
    assert paid_gates, "no require_paid object is reachable from the paid rows"

    # ⭐ AND THE SECOND SPELLING OF THE SAME RUNG, OR IT IS RANKED ON HALF ITS
    # DOORS. A `require_plan(list(PAID_PLANS))` product now reports `paid`, so
    # its admit-set has to be measured HERE too. Collected from the SERVED APP
    # rather than from `GATED` on purpose: those 12 routes are not in the table,
    # and being invisible to the table is the exact defect this rung was widened
    # to fix — sourcing them from it would inherit the blindness.
    factory_gates = {d for r in _table(app).values()
                     if getattr(r, "dependant", None) is not None
                     for d in _plan_gates(_dep_objects(r))}
    assert factory_gates, (
        "no `require_plan(...)` product is reachable from the served app — the "
        "factory half of the `paid` rung is ranked on nothing, and section 9 "
        "would be driving an empty route set while reading as a clean sweep")

    # ⚠️ AND THIS AGREEMENT IS OVER THIS FILE'S THREE DECLARED CALLERS ONLY. The
    # two families genuinely DISAGREE about a fourth, real plan value: `comped` is
    # admitted by `require_plan` and refused 402 by `require_paid`. That is not
    # measured here because `comped` is not one of the callers this ladder ranks —
    # it is measured and pinned by
    # `test_the_two_paid_gate_families_DISAGREE_about_comped`, and named in the
    # `paid` rung's own comment. A pass here is NOT evidence the two gates behave
    # alike; it is evidence they behave alike for free, paid and admin.
    seen = {frozenset(_admits(lambda u, g=g: g(dict(u))))
            for g in paid_gates | factory_gates}
    assert len(seen) == 1, (
        "the paid gates do not all admit the same callers: "
        f"{[sorted(x) for x in seen]} — one of them is not the gate the others "
        "are. Either a per-router `require_paid` copy drifted, or a "
        "`require_plan(...)` gate was built with a different plan list and is "
        "being ranked as if it opened the same door.")
    measured["paid"] = set(next(iter(seen)))

    # The flow family reads the cookie ITSELF, so the session lookup is patched
    # on `flow_admin_auth`'s own name — a patch on `auth_service` would reach
    # nothing (`lesson_from_import_severs_a_module_from_its_guards`).
    def _flow_admits(gate) -> set[str]:
        out = set()
        for name, user in callers.items():
            monkeypatch.setattr(fa, "validate_session", lambda _c, _u=user: dict(_u))
            try:
                if gate(uct_session="test-session") is not None:
                    out.add(name)
            except HTTPException:
                pass
        return out

    measured["flow_user"] = _flow_admits(fa.require_flow_user)
    measured["flow_admin"] = _flow_admits(fa.require_flow_admin)

    # ⭐ THE MACHINE DOOR. `require_push_secret` never looks at a user — it reads
    # one header — so the honest admit-set over this file's three declared
    # callers is EMPTY. An empty set is also what a gate that refuses EVERYTHING
    # produces, so it is only evidence if the same harness can be seen admitting.
    #
    # 🔴 FIX ROUND 2, OPEN 3. The first version wrote
    # `_admits(lambda _u: require_push_secret(_Req("")) or None)` and called that
    # "both directions". It was not: the real gate returns `None` on SUCCESS, so
    # that lambda yields `None` whether it passed or raised, and `_admits` — which
    # collects a caller only when the invoke returns non-None — could NEVER have
    # reported one. The empty set was true BY CONSTRUCTION, and the "positive
    # half" was a separate try/except that exercised none of the measuring
    # apparatus. A gate that admitted everybody would have measured `∅` too.
    #
    # ⛔ SO THE INVOKE NOW RETURNS THE CALLER ON ADMISSION, and the permissive
    # direction is measured THROUGH `_admits` itself: with the right bearer the
    # very same call path must report ALL THREE callers. That is what makes the
    # empty set below a measurement instead of a tautology.
    from api.routers.scan_live import require_push_secret

    class _Req:
        def __init__(self, auth):
            self.headers = {"authorization": auth} if auth else {}

    monkeypatch.setenv("PUSH_SECRET", "ladder-secret")

    def _worker_admits(auth: str) -> set:
        def _invoke(user):
            require_push_secret(_Req(auth))      # raises HTTPException if refused
            return dict(user)                    # …admitted: a non-None caller
        return _admits(_invoke)

    measured["worker"] = _worker_admits("")

    # THE PERMISSIVE DIRECTION, THROUGH THE SAME APPARATUS. If this were also
    # empty, the row above would be measuring the harness, not the gate.
    with_bearer = _worker_admits("Bearer ladder-secret")
    assert with_bearer == set(callers), (
        f"handed its OWN correct bearer, `require_push_secret` admitted "
        f"{sorted(with_bearer)} of {sorted(callers)} through this file's own "
        "`_admits`. The empty admit-set recorded for `worker` is therefore not "
        "evidence of a strict gate — it is what this harness returns no matter "
        "what the gate does, and the strongest rung on the ladder would be "
        "ranked on nothing.")
    assert not measured["worker"], (
        f"without a bearer the gate admitted {sorted(measured['worker'])} — a "
        "machine door is open to human callers")

    for klass, admitted in sorted(measured.items()):
        assert admitted == set(_ADMITS[klass]), (
            f"the ladder says {klass!r} admits {sorted(_ADMITS[klass])}; the "
            f"running gate admits {sorted(admitted)}. The strength order is a "
            "typed opinion, not a measurement, and every claim ranked against "
            "it is resting on the wrong number")

    # ⭐ ⛔ AND THE CONTROL MUST COVER THE LADDER, NOT A LIST BESIDE IT.
    # `measured` is built by hand above — four named calls — so it is itself a
    # second authority over the gate vocabulary, sitting inside the fix for a
    # second-authority defect. MEASURED, 2026-08-26: appending a sixth class to
    # `_GATE_LADDER` and running this file gave 94 passed, the new class SILENTLY
    # UNMEASURED. So the coverage is asserted against `GATE_CLASSES` itself: a
    # class can join the ladder only by also being measured here, or by being
    # named in the one documented exemption below.
    assert set(measured) | {"session"} == GATE_CLASSES, (
        f"the ladder declares {sorted(GATE_CLASSES)} and this control measures "
        f"{sorted(measured)}. `session` is the ONE documented exemption (it is "
        "not callable in this shape — see the docstring); anything else missing "
        "is a gate class whose admit-set nobody has ever checked, ranked against "
        "every claim in the table as if somebody had")

    # …and the ordering the whole strength rule turns on falls straight out of
    # the measured sets above rather than being asserted as an opinion beside
    # them. Chained PROPER SUBSETS, matching `_strongest`: everyone an admin gate
    # lets in, a paid gate lets in too, and a paid gate lets in somebody more.
    assert (_ADMITS["worker"] < _ADMITS["admin"] < _ADMITS["paid"]
            < _ADMITS["session"]), (
        f"worker > admin > paid > session is what `_claim_is_satisfied` rests "
        f"on, and it must hold as nesting rather than as a count: {_ADMITS}")

    # A claim can only mean something if the ladder can actually produce it.
    unknown = sorted(set(GATED.values()) - GATE_CLASSES)
    assert not unknown, (
        f"{unknown} are claimed in the gate table and `_klass_of` can never "
        "report them, so those rows can never be satisfied by any real gate")


def test_every_require_paid_gate_is_a_REAL_paid_check(app):
    """⛔ "NAMED `require_paid`" IS NOT "CHECKS PAYMENT".

    `require_paid` is defined once per router by design, so the structural test
    above can only match it by NAME — and a name is exactly what a regression
    can keep while changing what the function does. Each distinct
    `require_paid` object reachable from a gated route is therefore CALLED with
    a free member and must raise 402, and called with a paid member and must
    not raise. That is the behaviour, measured, per copy.
    """
    from fastapi import HTTPException

    gates = set()
    for key, expected in GATED.items():
        if expected != "paid":
            continue
        for dep in _dep_objects(_table(app)[key]):
            if getattr(dep, "__name__", "") == "require_paid":
                gates.add(dep)

    assert len(gates) >= 8, (
        f"only {len(gates)} distinct require_paid gates found across the paid "
        "routes — the walk is not reaching them")

    sentences = set()
    for gate in gates:
        with pytest.raises(HTTPException) as exc:
            gate(dict(FREE_USER))
        assert exc.value.status_code == 402, (gate, exc.value.status_code)
        sentences.add(exc.value.detail)
        assert gate(dict(PAID_USER)) is not None
        assert gate(dict(ADMIN_USER)) is not None

    assert len(sentences) == len(gates), (
        "two routers refuse with the SAME sentence — a member cannot tell which "
        f"surface locked them out: {sorted(sentences)}")


# ── 3. the behavioural half: anonymous is refused ────────────────────────────

def test_an_ANONYMOUS_caller_is_refused_on_every_safely_probeable_route(app, clean_overrides):
    """🔴 THE MEASUREMENT THIS CLOSES: 3.07 MB of options flow, 3.9 MB of
    detections and 1.68 MB of the delisted registry, to a caller with no
    credential of any kind.

    No overrides and no body — the real cookie path with an empty jar.
    Dependencies are solved before parameter validation, so a gated route
    refuses whatever it was or was not sent, while an UNGATED one answers 422 or
    200 and is caught here.
    """
    client = _client(app, ANON)
    table = _table(app)
    probed = []
    for key in sorted(GATED):
        if key in NEVER_PROBED:
            continue
        url, kwargs = _request_for(table[key], key, with_body=False)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code in REFUSALS, (
            f"{key[0]} {key[1]} answered an ANONYMOUS caller "
            f"{resp.status_code} — {resp.text[:200]}")
        probed.append(key)

    assert len(probed) == len(GATED) - len(NEVER_PROBED), probed


def test_the_harness_would_have_SEEN_an_open_door(app, clean_overrides):
    """⭐ THE CONTROL ON THE REFUSAL SWEEP.

    A sweep that refuses everything is also what a broken client, a 500ing app
    or a mis-built request would produce. So the same anonymous client is driven
    at a route that is deliberately open and must get a NON-refusal — which is
    what makes every refusal above evidence of a gate rather than evidence of a
    broken harness.
    """
    client = _client(app, ANON)
    resp = client.get("/api/health")
    assert resp.status_code not in REFUSALS, (
        f"the public health check refused an anonymous caller ({resp.status_code}) "
        "— the harness is not measuring gates, it is failing")


# ── 4. the behavioural half: a legitimate member still gets through ──────────

def test_a_PAID_member_is_NOT_refused_on_any_route_gated_here(app, monkeypatch, clean_overrides):
    """⚠️ THE HALF THAT TELLS A GATE FROM AN OUTAGE.

    A sweep of refusals is satisfied by a router that refuses everybody. Every
    safely-probeable route is driven again with a paid member and must not
    answer 401/402/403.

    ⛔ NOT asserted as 200: several of these read stores that are empty or absent
    on a dev box (flow.db, darkpool.db, pattern_detections), and a 404/503 from
    an empty store is a DATA fact, not an AUTH fact. Collapsing the two would
    make this file go red for the wrong reason and get "fixed" by loosening the
    thing it is protecting. The control below is what keeps that honest.
    """
    closed = _closed_to_paid()
    client = _client(app, PAID_USER, monkeypatch)
    table = _table(app)
    for key in sorted(GATED):
        if key in NEVER_PROBED or key in closed:
            continue
        url, kwargs = _request_for(table[key], key, with_body=True)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code not in REFUSALS, (
            f"{key[0]} {key[1]} REFUSED a paid member with {resp.status_code} — "
            f"the gate became an outage: {resp.text[:300]}")


def test_the_paid_pass_produces_REAL_successes_not_just_absence_of_refusal(
        app, monkeypatch, clean_overrides):
    """⭐ THE CONTROL ON THE PAID SWEEP.

    "Not refused" is satisfied by an app that 500s uniformly. This requires the
    paid pass to have produced a healthy number of actual 200s, so the assertion
    above rests on routes that really answered.
    """
    closed = _closed_to_paid()
    client = _client(app, PAID_USER, monkeypatch)
    table = _table(app)
    ok = []
    for key in sorted(GATED):
        if key in NEVER_PROBED or key in closed:
            continue
        url, kwargs = _request_for(table[key], key, with_body=True)
        if client.request(key[0], url, **kwargs).status_code == 200:
            ok.append(key)
    assert len(ok) >= 15, (
        f"only {len(ok)} of the gated routes answered a paid member 200 — the "
        f"paid sweep is not exercising real handlers: {ok}")


def test_an_ADMIN_is_not_refused_on_the_admin_routes(app, monkeypatch, clean_overrides):
    """The strictest doors must still open for the person they were built for —
    otherwise the operator surfaces are simply broken and nobody finds out until
    an incident."""
    client = _client(app, ADMIN_USER, monkeypatch)
    table = _table(app)
    for key, klass in sorted(GATED.items()):
        if klass not in ("admin", "flow_admin") or key in NEVER_PROBED:
            continue
        url, kwargs = _request_for(table[key], key, with_body=True)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code not in REFUSALS, (
            f"{key[0]} {key[1]} refused an ADMIN {resp.status_code} — "
            f"{resp.text[:300]}")


def test_a_FREE_member_is_refused_on_the_PAID_routes(app, monkeypatch, clean_overrides):
    """"Logged in" is not "paid". Signup is open and free, so a gate that only
    checks for a session leaves every one of these a free registration away."""
    client = _client(app, FREE_USER, monkeypatch)
    table = _table(app)
    checked = 0
    for key, klass in sorted(GATED.items()):
        if klass != "paid" or key in NEVER_PROBED:
            continue
        url, kwargs = _request_for(table[key], key, with_body=False)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code == 402, (
            f"{key[0]} {key[1]} answered a FREE member {resp.status_code} — "
            f"{resp.text[:200]}")
        checked += 1
    # ⚠️ A REAL FLOOR, NOT A LOOSE ONE. This counted 43 rows against a floor of
    # 30, so a THIRTEEN-ROUTE hole in the paid surface could open without moving
    # it. It is also the table-side half of the two-step detector: downgrading a
    # row's claim out of `paid` drops this count, and a floor that means anything
    # is what makes that drop say so.
    # ⚖️ 43 → 42 ON THE 2026-08-27 MASTER MERGE, AND THE FLOOR IS RE-MEASURED
    # RATHER THAN RELAXED. The rail fired exactly as written — "either a paid
    # route was retired, or a row's claim was moved out of `paid`" — and the
    # first of those is what happened: master retired the Patterns page and with
    # it TWO paid rows, `GET /api/patterns/scan` and `GET /api/patterns/types`
    # (40 paid at the merge base → 38 on master; this branch adds 4 → 42).
    # ⛔ NAMED, because a floor lowered without saying what moved is how coverage
    # erodes one route at a time with the rail still green.
    assert checked >= 42, (
        f"only {checked} paid rows were driven with a free member (floor 42) — "
        "either a paid route was retired, or a row's claim was moved out of "
        "'paid' and this sweep silently stopped covering it")


# ── 5. the free tier, which a paywall fix must not break ─────────────────────

def test_the_FREE_TIER_still_reads_the_morning_wire(app, monkeypatch, clean_overrides):
    """✋ `FREE_PAGES = ['/morning-wire']`, and these two routes ARE that page.

    Gating them on payment would refuse every free member the one thing they
    were invited in to read — a funnel outage wearing a paywall's clothes. They
    are gated on `get_current_user`, which is exactly the boundary the page
    already has, and this is the assertion that notices if that changes.
    """
    free = _client(app, FREE_USER, monkeypatch)
    for path in ("/api/rundown", "/api/rundown/speech-text"):
        resp = free.get(path)
        assert resp.status_code == 200, (
            f"{path} refused a FREE member {resp.status_code} — the free tier is "
            f"the top of the funnel and this closes it: {resp.text[:200]}")

    anon = _client(app, ANON)
    for path in ("/api/rundown", "/api/rundown/speech-text"):
        assert anon.get(path).status_code == 401, (
            f"{path} still answers an anonymous caller — the crawler hole is open")


# ── 6. the P0: a destructive operation is no longer behind a safe verb ───────

def test_the_destructive_purge_route_is_NOT_reachable_by_GET(app):
    """🔴 THE HEADLINE FINDING, ASSERTED AT THE ROUTE TABLE.

    `purge-old` archived active picks and answered a GET. A GET is fetched by
    crawlers, unfurl bots and prefetchers — nobody has to decide to call it.

    ⛔ ASSERTED AGAINST THE TABLE, NOT BY FIRING THE GET. If this ever regresses,
    firing the GET is exactly the request that performs the purge. The route
    table answers the question without asking the server to do anything.
    """
    table = _table(app)
    gets = [k for k in table if k[0] == "GET" and "purge-old" in k[1]]
    assert gets == [], (
        f"a destructive operation answers a SAFE verb again: {gets}. A link "
        "preview of that URL is a data-loss event nobody requested.")
    assert ("POST", "/api/top-flow/purge-old/{keep_days}") in table


def test_the_destructive_purge_route_refuses_an_anonymous_POST(app, clean_overrides):
    """…and the verb change is not the gate.

    ⛔ WHY THIS PROBE IS SAFE EVEN IF THE GATE IS GONE — which is the only case
    that matters. `keep_days` is sent as `"not-an-int"`. Gated, the dependency
    raises 403 before anything else runs. UNGATED, FastAPI cannot coerce the path
    param and answers 422 with the handler never entered — and even past that,
    `date.today() - timedelta(days="not-an-int")` raises before the first pick is
    touched. There is no ordering in which this request archives a pick.
    """
    client = _client(app, ANON)
    resp = client.post("/api/top-flow/purge-old/not-an-int")
    assert resp.status_code == 403, (
        f"anonymous POST to the purge route answered {resp.status_code}; 422 "
        "means the gate is gone and only the type annotation stopped it")


# ── 7. the unbounded query the sweep found ──────────────────────────────────

def test_breadth_monitor_days_is_bounded(app, monkeypatch, clean_overrides):
    """`?days=100000` returned 200 — a caller sizing the server's query.

    Bounded at 3,650 (ten years), comfortably past the 365 the widest surface
    asks for. Out of range is a 422, NOT a silent clamp: a caller that asked for
    100,000 sessions must be told the answer is not what it asked for rather
    than handed 3,650 dressed as it.
    """
    client = _client(app, PAID_USER, monkeypatch)
    assert client.get("/api/breadth-monitor", params={"days": 100000}).status_code == 422
    assert client.get("/api/breadth-monitor", params={"days": 0}).status_code == 422
    assert client.get("/api/breadth-monitor", params={"days": 90}).status_code == 200


# ── 8. the entitlement gap: the AI door is bounded per caller ────────────────

def test_the_AI_door_bounds_how_many_proposals_one_member_may_fire():
    """`POST /api/user-definitions/propose` carried `require_paid` and no
    invocation bound at all — a one-time yes/no in front of a per-request model
    spend. `MAX_PROPOSE_BARS` capped how BIG a call was; nothing capped HOW MANY.

    Tested on the charge function rather than through the route, because driving
    the route means running the concierge, and a rate-limit test that costs
    tokens per assertion is its own kind of unbounded spend.
    """
    from fastapi import HTTPException
    from api.routers import user_definitions as ud

    ud._propose_calls.clear()
    t0 = 1_000_000.0
    for i in range(ud.PROPOSE_MAX_PER_HOUR):
        ud._charge_propose("u1", now=t0 + i)

    with pytest.raises(HTTPException) as exc:
        ud._charge_propose("u1", now=t0 + ud.PROPOSE_MAX_PER_HOUR)
    assert exc.value.status_code == 429
    assert exc.value.headers.get("Retry-After")

    # …and the bound is PER CALLER, not global: one member exhausting their hour
    # must not lock out everybody else.
    ud._charge_propose("u2", now=t0 + ud.PROPOSE_MAX_PER_HOUR)

    # …and it is a WINDOW, not a lifetime cap — an hour later the door reopens.
    ud._charge_propose("u1", now=t0 + 3601 + ud.PROPOSE_MAX_PER_HOUR)
    ud._propose_calls.clear()


def test_the_AI_DOOR_ITSELF_enforces_the_bound_not_just_the_helper(
        app, monkeypatch, clean_overrides):
    """🔴 THE HALF THE TEST ABOVE IS STRUCTURALLY BLIND TO.

    MEASURED, not assumed: a mutation run on 2026-08-09 deleted
    `_charge_propose(...)` from the handler — the WIRE — and the test above
    stayed GREEN, because it calls the helper directly. Both halves correct,
    nothing connecting them: `lesson_built_tested_green_and_unreachable`, and the
    exact shape the 2026-08-08 audit said the repo keeps shipping.

    So this drives the ROUTE and mocks nothing on the path under test.

    ⛔ AND IT NEVER SPENDS A TOKEN. `_charge_propose` runs BEFORE the
    `MAX_PROPOSE_BARS` check, so an over-long `bars` array makes every request
    return 400 without the concierge ever being imported — while still being
    CHARGED. The tell is therefore 400 → 400 → 400 → 429: the bound fires on a
    request that never reached a model. Delete the call site and it is 400
    forever, and this goes red.
    """
    from api.routers import user_definitions as ud

    monkeypatch.setattr(ud, "PROPOSE_MAX_PER_HOUR", 3)
    ud._propose_calls.clear()
    client = _client(app, PAID_USER, monkeypatch)
    body = {"prompt": "x", "bars": [0] * (ud.MAX_PROPOSE_BARS + 1)}

    seen = [client.post("/api/user-definitions/propose", json=body).status_code
            for _ in range(4)]
    ud._propose_calls.clear()

    assert seen[:3] == [400, 400, 400], (
        f"expected the bars cap to refuse each charged call without reaching the "
        f"model, got {seen}")
    assert seen[3] == 429, (
        f"the fourth call past a cap of 3 answered {seen[3]}, not 429 — the "
        "handler is not charging the caller, so the AI door is unbounded again")


# ── 9. ⭐ THE FACTORY-PRODUCED GATE: 12 ROUTES WITH NO GATE NAME AT ALL ───────
#
# 🔴 WHAT WAS TRUE UNTIL THIS SECTION EXISTED — MEASURED, ONE MUTATION AT A
# TIME, 2026-08-26: `require_plan` is a factory, called once per router at module
# scope, so the 12 routes it gates read `Depends(_paid)` and carry no gate NAME
# anywhere the ladder could match. Each gate was swapped for `get_current_user`
# in turn (the DANGEROUS shape: the route stays reachable by any free account and
# merely stops being paid) and the whole suite for that router re-run. FOUR of the
# twelve reddened NOTHING:
#
#   POST   /api/j2/broker/accounts/refresh
#   PUT    /api/j2/broker/accounts/{broker_account_id}
#   DELETE /api/j2/broker/connections
#   PUT    /api/j2/notes/connectors/sources/{source_id}
#
# — re-syncing a brokerage, and editing or deleting a brokerage connection or a
# note source, every one of them free-reachable with the whole suite still green.
# The other eight were caught by `tests/test_broker_router.py` (3) and
# `tests/test_note_sync_router.py` (5), which is why this section drives all
# twelve rather than the four: a rail that covers only today's gap is the same
# hand-list, one iteration later.
#
# ⛔ SO THE ROUTE SET IS DERIVED FROM THE APP, NEVER LISTED. A hand-written list
# covers the routes that existed the day it was typed, which is the shape the
# gap above has: the covered routes are the ones a test was written BESIDE, and
# the uncovered ones are whatever the router grew afterwards.
# `tests/test_nhnl_router.py` already says it out loud — "a hand-listed test
# would leave the next route uncovered the day someone adds it". Everything
# below reads `_plan_gates(...)` off the served app instead, so a thirteenth
# route — in these two routers or in a third that adopts the idiom tomorrow — is
# covered with no edit here.


def _plan_gated_keys(app) -> list:
    """Every `(method, path)` on the SERVED APP whose dependency tree carries a
    `require_plan(...)` product. DERIVED — see the section note above."""
    return sorted(k for k, r in _table(app).items()
                  if getattr(r, "dependant", None) is not None
                  and _plan_gates(_dep_objects(r)))


#: 🔴 THE FACTORY-GATED SURFACE, PINNED — same ratchet rule as
#: `PAID_SURFACE_FLOOR`. Measured 2026-08-26: 12 routes, 6 in `broker_sync.py`
#: and 6 in `note_sync.py`.
#:
#: ⭐ THIS NUMBER IS THE WHOLE DIFFERENCE BETWEEN A SWEEP AND A CLEAN BILL OF
#: HEALTH. A derivation that silently resolved to ZERO routes — a renamed inner
#: `checker`, a router unmounted, a walk that stopped reaching nested
#: dependants — drives nothing, asserts nothing, and reports PASSED. Every test
#: below counts what it actually drove and compares it to this.
PLAN_GATED_FLOOR = 12

#: A route on one of the SAME routers that is deliberately NOT plan-gated —
#: `broker_sync.py`'s own docstring says status is readable by any logged-in user
#: so the upsell can render. It is the control for the handler spy below: an
#: apparatus that never records anything cannot prove that nothing ran.
PLAN_GATE_SPY_CONTROL = ("GET", "/api/j2/broker/status")


def test_the_census_can_SEE_a_gate_that_has_no_name_at_the_call_site(app):
    """⭐ THE FIX ITSELF: `_klass_of` now reports `paid` for a factory gate.

    Before this, `Depends(_paid)` reported `session` at best — so a `session`
    claim would have satisfied any of these 12 routes and a downgrade would have
    been invisible, which is door 1 of this file's history reached through door 3.

    ⛔ AND THE READER MUST BE ABLE TO SAY *NOT* A PLAN GATE. A detector that
    answered "gated" about everything would satisfy the loop below while proving
    nothing, so the complement is asserted too: every other route on the app must
    report no paid-plan gate, and the complement must be large enough that the
    claim means something (`test_the_gate_reader_can_report_UNGATED`, same shape).
    """
    table = _table(app)
    keys = _plan_gated_keys(app)
    assert len(keys) >= PLAN_GATED_FLOOR, (
        f"the derivation found {len(keys)} factory-gated routes, floor "
        f"{PLAN_GATED_FLOOR}. Either a `require_plan` gate was deleted from a "
        "handler — restore it — or the reader stopped resolving the factory's "
        "product and every sweep in this section is now driving fewer routes "
        "than it claims to cover.")

    for key in keys:
        found = _klass_of(table[key])
        assert _claim_is_satisfied("paid", found), (
            f"{key[0]} {key[1]} carries `require_plan(list(PAID_PLANS))` and the "
            f"census reports {sorted(found) or 'NO GATE AT ALL'}. A `paid` claim "
            "cannot be made for it, and a `session` claim would be accepted — the "
            "gate is invisible to this audit again.")

    reads_false = [k for k, r in table.items()
                   if getattr(r, "dependant", None) is not None
                   and k not in set(keys)
                   and not _is_paid_plan_gated(_dep_objects(r))]
    assert len(reads_false) >= 1000, (
        f"only {len(reads_false)} routes read as NOT plan-gated — the reader is "
        "answering 'paid plan gate' about most of the app, so the loop above is "
        "satisfied by a detector that cannot say no")


def test_DELETING_the_FACTORY_gate_reds_the_paid_class_it_reports(app):
    """🔴 THE MUTATION, ALWAYS ARMED — the door, not the label.

    `test_DELETING_require_paid_FROM_A_HANDLER_reds_the_row_that_claims_paid`
    cuts by the NAME `require_paid`, which is precisely the name these 12 routes
    do not have, so it walks straight past them. This is that control for door 3:
    the factory gate is stripped off the SERVED app's own `route.dependant` — the
    same object `_klass_of` reads — and the route must stop reporting `paid`.

    ⚠️ RESTORED IN A `finally`, AND THE RESTORE IS ASSERTED. The `app` fixture is
    module-scoped; a leaked cut would poison every assertion after this one and a
    silent restore failure would read as a pass.
    """
    table = _table(app)
    cut = []
    for key in _plan_gated_keys(app):
        route = table[key]
        idx = next((i for i, d in enumerate(route.dependant.dependencies)
                    if _plan_gate_allows(d.call) is not None), None)
        if idx is None:
            continue
        original = list(route.dependant.dependencies)
        before = _klass_of(route)
        try:
            route.dependant.dependencies = [d for j, d in enumerate(original)
                                            if j != idx]
            opened = _klass_of(route)
            assert not _claim_is_satisfied("paid", opened), (
                f"{key[0]} {key[1]} had its `require_plan` gate DELETED and the "
                f"app still reports {sorted(opened)} as strong as paid. A paid, "
                "member-facing route can be opened to any free registration and "
                "this census does not notice — which is the state it was in "
                "before this section existed.")
        finally:
            route.dependant.dependencies = original
        # ⛔ THE RESTORE CHECK COMPARES TO WHAT THIS ROUTE REPORTED BEFORE THE CUT,
        # NOT TO A `paid` CLAIM. It used to assert that `paid` came back, which is
        # a DIFFERENT QUESTION, and it misdiagnosed: with a gate widened to admit
        # free members the route never reported `paid` in the first place, so this
        # line fired "did not come back after the mutation" about an app that had
        # been restored perfectly — sending the reader hunting a corruption that
        # never happened, while the real defect was already named BY PATH two tests
        # up. A rail that lies about a SUCCESSFUL restore costs more than one that
        # says nothing, because it discredits every restore assertion beside it.
        after = _klass_of(route)
        assert after == before, (
            f"{key[0]} {key[1]} reported {sorted(before)} before the cut and "
            f"{sorted(after)} after the restore — the dependency list did not come "
            "back, and every assertion after this one is running against a damaged "
            "app")
        cut.append(key)

    assert len(cut) >= PLAN_GATED_FLOOR, (
        f"only {len(cut)} factory-gated routes carry the gate as a DIRECT "
        f"dependency (floor {PLAN_GATED_FLOOR}) — the cut is not reaching the "
        "gates it claims to delete, so this control is grading a smaller surface "
        "than it reports")


def test_a_FREE_member_is_refused_on_every_FACTORY_gated_route(
        app, monkeypatch, clean_overrides):
    """⭐ THE DELIVERABLE: all 12, driven, as a free member.

    ⛔ 403, NOT 402, AND THE DIFFERENCE IS MEASURED NOT ASSUMED. `require_paid`
    raises 402 "payment required"; `require_plan`'s checker raises 403 "Upgrade
    required". Both are refusals and `REFUSALS` holds both — but this asserts the
    exact code, because "some refusal happened" is also what a 401 from a broken
    session lookup looks like, and that would pass while proving the PLAN check
    never ran at all.

    ⚠️ NO BODY IS SENT, AND THAT IS THE WHOLE IDIOM (see `BODY_SAMPLES`).
    Dependencies are solved BEFORE `request_params_to_args`, so a gated route
    answers its refusal whatever the body is, while an UNGATED one answers 422 —
    which is how a deleted gate is caught rather than hidden behind a happy path.
    `test_the_no_body_probe_would_have_SEEN_a_deleted_factory_gate` is the control
    that keeps that sentence a measurement.
    """
    client = _client(app, FREE_USER, monkeypatch)
    table = _table(app)
    keys = _plan_gated_keys(app)
    driven = 0
    for key in keys:
        url, kwargs = _request_for(table[key], key, with_body=False)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code == 403, (
            f"{key[0]} {key[1]} answered a FREE member {resp.status_code} — "
            f"{resp.text[:200]}")
        driven += 1

    assert driven == len(keys) >= PLAN_GATED_FLOOR, (
        f"drove {driven} of {len(keys)} factory-gated routes against a floor of "
        f"{PLAN_GATED_FLOOR}. A sweep that drives nothing passes silently; this "
        "is the arithmetic that stops it reading as a clean bill of health.")


def test_the_FACTORY_gated_refusal_happens_at_the_DEPENDENCY_and_NO_HANDLER_RUNS(
        app, monkeypatch, clean_overrides):
    """⛔ `lesson_never_probe_a_mutating_endpoint_to_test_auth`, ANSWERED.

    Two of these are a PUT and two a DELETE. Firing them at a real handler is
    safe only WHILE the gate works — and "while the gate works" is the very thing
    under test, so it cannot be the assumption the safety rests on. This proves
    the refusal lands BEFORE the handler: every one of the 12 endpoint functions
    is wrapped in a spy, the free sweep is run again, and not one of them may be
    entered. Nothing can have mutated, because nothing ran.

    ⭐ AND THE SPY CARRIES ITS OWN CONTROL. "Zero handlers ran" is also what a spy
    that was never installed reports, so the same apparatus is pointed at a route
    on the SAME router that is deliberately open to any logged-in member
    (`PLAN_GATE_SPY_CONTROL`) and must record THAT one running. An empty list is
    only evidence when the list can be seen filling up.

    ⚠️ `route.dependant.call` is what `run_endpoint_function` invokes, and the
    request handler reads it at call time — so wrapping it after the app is built
    is what makes this observable at all. Restored in a `finally`, on a
    module-scoped app, and the restore is asserted.
    """
    table = _table(app)
    keys = _plan_gated_keys(app)
    assert PLAN_GATE_SPY_CONTROL in table, (
        f"{PLAN_GATE_SPY_CONTROL} is not mounted — the spy's own control is gone "
        "and 'no handler ran' would be unfalsifiable")
    assert PLAN_GATE_SPY_CONTROL not in set(keys), (
        f"{PLAN_GATE_SPY_CONTROL} is plan-gated now, so it can no longer serve as "
        "the control for the spy: it would refuse too, and an empty spy log would "
        "prove nothing")

    ran = []
    originals = []
    for key in list(keys) + [PLAN_GATE_SPY_CONTROL]:
        route = table[key]
        original = route.dependant.call
        originals.append((route, original))

        def _spy(*a, _orig=original, _key=key, **kw):
            ran.append(_key)
            return _orig(*a, **kw)

        route.dependant.call = _spy

    try:
        client = _client(app, FREE_USER, monkeypatch)
        for key in keys:
            url, kwargs = _request_for(table[key], key, with_body=False)
            resp = client.request(key[0], url, **kwargs)
            assert resp.status_code == 403, (
                f"{key[0]} {key[1]} answered a FREE member {resp.status_code}")
        assert not ran, (
            f"a free member's refused request ENTERED {sorted(set(ran))}. The "
            "refusal is happening after the handler, not at the dependency — a "
            "PUT or a DELETE among these has already touched member data by the "
            "time the 403 is written.")

        control_url, control_kwargs = _request_for(
            table[PLAN_GATE_SPY_CONTROL], PLAN_GATE_SPY_CONTROL, with_body=False)
        client.request(PLAN_GATE_SPY_CONTROL[0], control_url, **control_kwargs)
        assert PLAN_GATE_SPY_CONTROL in ran, (
            f"the spy did not record {PLAN_GATE_SPY_CONTROL} even though that "
            "route is open to any logged-in member. The spy is not installed, so "
            "the empty log above is what this harness returns no matter what the "
            "handlers do.")
    finally:
        for route, original in originals:
            route.dependant.call = original

    for route, original in originals:
        assert route.dependant.call is original, (
            "an endpoint spy was not removed — every test after this one is "
            "running against a wrapped app")


def test_the_no_body_probe_would_have_SEEN_a_deleted_factory_gate():
    """⛔ THE CONTROL ON THE IDIOM, NOT ON THE ROUTES.

    The sweep above sends NO BODY and asserts 403. That only means anything if an
    UNGATED route would have answered something else — otherwise "gated" and
    "open" are indistinguishable and the whole section is measuring the absence of
    a body. Two twin routes are built here, identical but for the gate, and driven
    the same way: the gated one refuses at the dependency, the ungated one gets as
    far as validating the body it never received.

    ⭐ The gate is the REAL `require_plan(list(PAID_PLANS))` product, built by the
    same factory the two routers call — not a stand-in, so this cannot keep
    passing after the factory's behaviour changes.
    """
    from fastapi import Depends, FastAPI
    from pydantic import BaseModel

    class _Body(BaseModel):
        value: str

    gate = require_plan(list(PAID_PLANS))
    twin = FastAPI()

    @twin.put("/gated/{item_id}")
    def _gated(item_id: str, body: _Body, user: dict = Depends(gate)):
        return {"ran": "gated"}

    @twin.put("/ungated/{item_id}")
    def _ungated(item_id: str, body: _Body):
        return {"ran": "ungated"}

    twin.dependency_overrides[get_current_user_with_plan] = lambda: dict(FREE_USER)
    client = TestClient(twin, raise_server_exceptions=False)

    gated = client.put("/gated/no-such-item")
    assert gated.status_code == 403, (
        f"the twin GATED route answered {gated.status_code} to a free member with "
        f"no body — {gated.text[:200]}")

    ungated = client.put("/ungated/no-such-item")
    assert ungated.status_code == 422, (
        f"the twin UNGATED route answered {ungated.status_code} to the SAME "
        "no-body request. If an ungated route refuses too then 403 on the 12 "
        "routes above is not evidence of a gate, and this whole section is "
        "measuring the missing body instead.")
    assert ungated.status_code not in REFUSALS


def test_every_require_plan_gate_in_the_served_app_is_a_REAL_paid_check(app):
    """⛔ "BUILT BY `require_plan`" IS NOT "CHECKS FOR PAYMENT".

    The `paid` rung classifies a factory gate by the plan list it was CONSTRUCTED
    with. That is a claim about a closure, so every distinct gate object reachable
    from the served app is CALLED here: a free member must be refused 403, and a
    paid member and an admin must both get through. Per copy, measured — the same
    contract `test_every_require_paid_gate_is_a_REAL_paid_check` holds the
    function-shaped half of this rung to.

    ⭐ AND THIS IS THE ROT CONTROL ON THE CLASSIFICATION. `require_plan` is a
    general factory: nothing stops a future caller building one over a list that
    admits a free plan. Such a gate must FAIL HERE BY NAME rather than be swept in
    with the paid ones — a census that quietly mis-files a gate is worse than one
    that cannot see it, because the mis-filing looks like coverage.

    ⚠️ ONE DELIBERATE DIFFERENCE FROM THE `require_paid` CONTRACT, NAMED SO IT IS
    A DECISION AND NOT A GAP: that test asserts every router refuses with a
    DISTINCT sentence, so a locked-out member can tell which surface said no. Both
    factory gates answer the same "Upgrade required", because both are the same
    `require_plan` closure over the same plan list — there is one sentence by
    construction. It is asserted as a constant below rather than left unmentioned.
    """
    from fastapi import HTTPException

    gates = {d for r in _table(app).values()
             if getattr(r, "dependant", None) is not None
             for d in _plan_gates(_dep_objects(r))}
    assert len(gates) >= 2, (
        f"only {len(gates)} distinct `require_plan` gate objects are reachable "
        "from the served app; `broker_sync.py` and `note_sync.py` each build "
        "their own, so the walk is not reaching both routers")

    for gate in sorted(gates, key=id):
        allowed = _plan_gate_allows(gate)
        assert allowed, (
            "a `require_plan` gate is reachable whose plan list could not be read "
            "off its closure. It is being classified `paid` on a guess — read the "
            "factory in `api/middleware/auth_middleware.py` and fix the reader.")
        assert allowed <= PAID_PLANS, (
            f"a `require_plan` gate admits {sorted(allowed)}, which is not a "
            f"subset of PAID_PLANS ({sorted(PAID_PLANS)}). The `paid` rung would "
            "report it as a paid door, and a `paid` claim on its routes would be "
            "satisfied by a gate that lets a free member in.")

        with pytest.raises(HTTPException) as exc:
            gate(dict(FREE_USER))
        assert exc.value.status_code == 403, (gate, exc.value.status_code)
        assert exc.value.detail == "Upgrade required", (
            f"the factory gate refuses with {exc.value.detail!r}; this section "
            "asserts 403 by exact code and the sentence is part of the same "
            "contract — re-measure the refusal before changing either")
        assert gate(dict(PAID_USER)) is not None
        assert gate(dict(ADMIN_USER)) is not None


#: ⛔ A FOURTH CALLER, DELIBERATELY NOT ADDED TO THE LADDER'S THREE. `comped` is a
#: real plan value (an account comped to paid), and the two paid-gate families
#: disagree about it — see the `paid` rung's comment. It lives here rather than
#: beside FREE/PAID/ADMIN because adding it to `callers` would make
#: `test_the_gate_ladder_MEASURES_who_each_gate_admits` demand ONE answer from two
#: gates that give different ones, and the ladder would then have to pick a winner
#: — which is exactly the product decision this file must not make.
COMPED_USER = {"id": "comp-1", "email": "comp@example.test",
               "role": "member", "plan": "comped"}


def test_the_two_paid_gate_families_DISAGREE_about_comped(app):
    """⛔⛔ THE `paid` RUNG IS ONE CLASS, NOT ONE CHECK — AND THIS IS THE CASE.

    The rung reports `paid` for two different gate families, and
    `test_the_gate_ladder_MEASURES_who_each_gate_admits` proves they admit the
    same set of this file's three declared callers. It is easy to read that as
    "the two gates are the same check". They are not:

        plan == "comped"  →  `require_plan(...)` ADMITS
                          →  `require_paid`      REFUSES 402

    `require_plan`'s checker tests `plan == "comped"` explicitly, beside the
    allowed-plans membership; the per-router `require_paid` copies consult
    `is_paid_user` and do not. So a comped account opens every brokerage and
    note-connector route and is turned away from every other paid surface in the
    product. That is a live disagreement about a real member's access.

    ⭐ THIS TEST DOES NOT FIX IT — IT PINS IT. Which family is right is a product
    decision and it has been escalated; reconciling the two here would decide it
    in a test file. What this refuses is the third outcome: the disagreement
    resolving QUIETLY, in either direction, leaving the `paid` rung's comment
    describing a world that no longer exists.

    ⛔ SO IF THIS GOES RED, THE ANSWER IS NEVER TO DELETE IT. Either the ruling
    landed — update the rung's disclosure in the SAME commit and say which way it
    went — or one family drifted by accident, which is the regression.

    ⚠️ BOTH DIRECTIONS ARE ASSERTED, AND SO ARE THE POPULATION SIZES. "Every gate
    admitted comped" is also what an empty gate set reports, and a walk that
    stopped reaching the routers would satisfy either half of this vacuously.
    """
    from fastapi import HTTPException

    def _admits_comped(gate) -> bool:
        try:
            return gate(dict(COMPED_USER)) is not None
        except HTTPException:
            return False

    routed = [r for r in _table(app).values()
              if getattr(r, "dependant", None) is not None]

    factory_gates = {d for r in routed for d in _plan_gates(_dep_objects(r))}
    paid_gates = {d for r in routed for d in _dep_objects(r)
                  if getattr(d, "__name__", "") == "require_paid"}

    assert len(factory_gates) >= 2, (
        f"only {len(factory_gates)} `require_plan` products reachable — "
        "`broker_sync.py` and `note_sync.py` each build one, so the walk is not "
        "reaching both routers and either half below would pass vacuously")
    assert len(paid_gates) >= 30, (
        f"only {len(paid_gates)} `require_paid` copies reachable (measured 38 on "
        "2026-08-26) — the walk is not reaching the paid surface")

    # HALF ONE: the factory family lets a comped account in.
    not_admitting = [g for g in factory_gates if not _admits_comped(g)]
    assert not not_admitting, (
        f"{len(not_admitting)} of {len(factory_gates)} `require_plan` gates now "
        "REFUSE a comped account. The two paid-gate families no longer disagree, "
        "so the `paid` rung's comment above — which says they do, and names this "
        "as an escalated product decision — is now false. Update it in this "
        "commit and say which way the ruling went. Do not delete this test.")

    # HALF TWO: the function family turns the same account away, with a 402.
    admitting = []
    for gate in paid_gates:
        try:
            gate(dict(COMPED_USER))
            admitting.append(getattr(gate, "__module__", gate))
        except HTTPException as exc:
            # ⛔ 402 EXACTLY. "It refused" is also what a 401 or a 500-shaped
            # refusal looks like, and either would let this test keep reporting a
            # disagreement that had actually become a broken gate.
            assert exc.status_code == 402, (gate, exc.status_code)
    assert not admitting, (
        f"{len(admitting)} `require_paid` copies now ADMIT a comped account "
        f"({sorted(set(map(str, admitting)))[:5]}). Same as the half above: the "
        "families have been reconciled and the rung's disclosure must be "
        "rewritten in this commit rather than left describing the old world.")
