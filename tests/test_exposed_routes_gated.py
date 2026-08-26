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
    get_current_user,
    get_current_user_with_plan,
    require_admin,
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
    ("GET", "/api/patterns/scan"): "paid",
    ("GET", "/api/patterns/types"): "paid",
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
    ("paid",       lambda n, o: "require_paid" in n,       frozenset({"paid", "admin"})),
    ("flow_admin", lambda n, o: "require_flow_admin" in n, frozenset({"admin"})),
    ("admin",      lambda n, o: require_admin in o,        frozenset({"admin"})),
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
    """The strongest classes in `found` — strongest = admits the FEWEST callers.

    Returns a SET, not a winner. Two classes can be genuinely equal (`admin` and
    `flow_admin` are one door reached two ways), and breaking that tie would be
    an ordering nobody measured. An ungated route has no strongest class at all.
    """
    if not found:
        return set()
    fewest = min(len(_ADMITS[klass]) for klass in found)
    return {klass for klass in found if len(_ADMITS[klass]) == fewest}


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
        weaker = len(_ADMITS[expected]) < min(len(_ADMITS[k]) for k in strongest)
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

    ⭐ AND IT CARRIES ITS OWN NON-VACUITY CONTROL. On some routes the cut leaves
    nothing behind, and "NO GATE AT ALL" would fail any check ever written. The
    dangerous shape is the other one: a sibling dependency still resolves the
    session, so the route stays perfectly reachable by any free account and
    merely stops being PAID — `POST /api/scans/run` keeps its rate-limit
    dependency exactly that way. At least one route must be of that shape, or
    this test is passing for the easy reason and proving far less than it reads.

    ⚠️ RESTORED IN A `finally`, AND THE RESTORE IS ASSERTED. The `app` fixture is
    module-scoped: a leaked mutation would poison every assertion after this one,
    and a silent restore failure would read as a pass.
    """
    table = _table(app)
    cut_anything, still_reachable = [], []

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
        if opened:
            still_reachable.append((key, sorted(opened)))

    assert len(cut_anything) >= 8, (
        f"only {len(cut_anything)} paid rows carry `require_paid` as a direct "
        "dependency — the walk is not reaching the gates it claims to cut")
    assert still_reachable, (
        "every paid route lost ALL its classes when `require_paid` was cut, so "
        "this test only ever proves that 'no gate' fails — it never exercises "
        "the shape it exists for: a route still reachable by a logged-in free "
        "member that simply is not paid any more")


def test_a_LEGITIMATELY_session_gated_route_still_passes(app):
    """…and the strength rule is not simply "reject more".

    The free tier is gated on identity, not payment, ON PURPOSE. A rule that
    made `session` unclaimable would be satisfied by closing the top of the
    funnel — so the rows that really are session-only must still pass, and the
    control is that they carry `session` and nothing stronger.
    """
    table = _table(app)
    session_rows = [k for k, v in sorted(GATED.items()) if v == "session"]
    assert session_rows, "no session-gated row left to control on"
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
    seen = {frozenset(_admits(lambda u, g=g: g(dict(u)))) for g in paid_gates}
    assert len(seen) == 1, (
        "the per-router `require_paid` copies do not admit the same callers: "
        f"{[sorted(x) for x in seen]} — one of them is not the gate the others are")
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

    for klass, admitted in sorted(measured.items()):
        assert admitted == set(_ADMITS[klass]), (
            f"the ladder says {klass!r} admits {sorted(_ADMITS[klass])}; the "
            f"running gate admits {sorted(admitted)}. The strength order is a "
            "typed opinion, not a measurement, and every claim ranked against "
            "it is resting on the wrong number")

    # …and the ordering the whole strength rule turns on falls straight out of
    # the numbers above rather than being asserted as an opinion beside them.
    assert len(_ADMITS["admin"]) < len(_ADMITS["paid"]) < len(_ADMITS["session"]), (
        f"admin > paid > session is what `_claim_is_satisfied` rests on: {_ADMITS}")

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
    admin_only = {k for k, v in GATED.items() if v in ("admin", "flow_admin")}
    client = _client(app, PAID_USER, monkeypatch)
    table = _table(app)
    for key in sorted(GATED):
        if key in NEVER_PROBED or key in admin_only:
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
    admin_only = {k for k, v in GATED.items() if v in ("admin", "flow_admin")}
    client = _client(app, PAID_USER, monkeypatch)
    table = _table(app)
    ok = []
    for key in sorted(GATED):
        if key in NEVER_PROBED or key in admin_only:
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
    assert checked >= 30, checked


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
