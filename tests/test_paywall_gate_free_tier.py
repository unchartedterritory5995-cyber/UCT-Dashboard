"""🔴 FINDING 4: `get_current_user` PROVES A SESSION AND NOTHING ELSE — AND
SIGNUP IS OPEN AND FREE. 55 FIRM-PROPRIETARY ROUTES NOW CHECK PAYMENT.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
`.superpowers/sdd/audit/auth-paywall-report.md` (Finding 4) measured **323**
`/api` routes whose entire gate was `get_current_user` — `validate_session`, a
401 if absent, and no plan, trial or subscription consulted anywhere. `POST
/api/auth/signup` is open, free, and does not redirect to Stripe. So the only
thing standing in front of those routes was the React router, and
`AuthGuard.jsx:139` renders `<Navigate>`: it hides a nav link and redirects a
browser. **It does not refuse a request.** Every one of them answered a `curl`
carrying a free session cookie.

Of the 323, this task closed the ones that serve the firm's own research or spend
the firm's money — the Compass knowledge base, the Model Book, earnings
intelligence, AI Search, flow explanations, calendar personalization, and the
per-symbol research relays. `PAID_NOW` is that set.

⛔ AND THE OTHER HALF IS ASSERTED TOO. `LEFT_OPEN` pins the routes that are
DELIBERATELY still session-only because a FREE member's Morning Wire journey
walks through them. A later paywall pass that closes one of those is not a
tightening, it is a funnel outage, and this file goes red for it.

NOTHING IS TYPED THAT COULD BE DERIVED
--------------------------------------
  * the route table is `api.main:app`'s — the app the product actually serves;
  * every `(method, path)` here is CHECKED to exist in it, so a rename empties
    this file LOUDLY rather than quietly (`lesson_probe_names_must_be_derived_
    not_typed`, and the `_fetch_naaim` guard that passed vacuously);
  * gates are read off `route.dependant` by name/identity, never off source text;
  * the class reader carries a CONTROL proving it can still say "ungated";
  * and the FREE-TIER reach is derived by **walking the frontend import graph**
    from `pages/MorningWire.jsx`, not from a list of pages someone remembered.

⭐ THE PAID HALF IS ASSERTED, BECAUSE A GATE THAT BLOCKS EVERYONE IS NOT A FIX.

⛔ AND SOME ROUTES ARE NEVER DRIVEN WITH A REQUEST.
`lesson_never_probe_a_mutating_endpoint_to_test_auth` in its COST form: probing
an endpoint to see whether it refuses you is safe only when it *does*. In the
one case this file exists to detect — the gate is gone — the request is not
refused and the handler RUNS, and what several of these run is an Opus call, a
Perplexity search, or a draw on the AlphaVantage 25-calls-a-day budget. Those are
verified structurally and by calling the gate object directly. `NEVER_PROBED`
says which, and why, per route.
"""
from __future__ import annotations

import os
import re
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.middleware.auth_middleware import (  # noqa: E402
    get_current_user,
    get_current_user_with_plan,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO_ROOT, "app", "src")


# ── the gate table ───────────────────────────────────────────────────────────
#
# ⛔ THE PATHS ARE A CLAIM, NOT THE MEASUREMENT. Each is resolved against the
# derived route table; the gate is read off `route.dependant`.
PAID_NOW: set[tuple[str, str]] = {
    # ── Compass brain / knowledge base (api/routers/intelligence.py) ─────────
    ("GET", "/api/analogs"),
    ("GET", "/api/coaching-notes"),
    ("GET", "/api/confidence-scores/{symbol}"),
    ("GET", "/api/leader-persistence/{symbol}"),
    ("GET", "/api/model-examples"),
    ("GET", "/api/pre-trade-checklist"),
    ("GET", "/api/psychology-events"),
    ("GET", "/api/risk-summary"),
    ("GET", "/api/setup-performance/{setup_type}"),
    ("GET", "/api/setup-templates"),
    ("GET", "/api/setup-templates/{name}"),
    ("GET", "/api/skill-assessments"),
    # ── Model Book reads (api/routers/modelbook.py) ──────────────────────────
    ("GET", "/api/modelbook/all-stocks"),
    ("GET", "/api/modelbook/index-drawings"),
    ("GET", "/api/modelbook/intraday-day"),
    ("GET", "/api/modelbook/setup-example/{example_id}/bars"),
    ("GET", "/api/modelbook/setup-examples"),
    ("GET", "/api/modelbook/stock/{stock_id}"),
    ("GET", "/api/modelbook/stock/{stock_id}/bars"),
    ("GET", "/api/modelbook/stocks"),
    ("GET", "/api/modelbook/year-earnings"),
    ("GET", "/api/modelbook/year-recap"),
    ("GET", "/api/modelbook/year-stats"),
    ("GET", "/api/modelbook/years"),
    # ── Earnings intelligence (api/routers/earnings_intel.py) ────────────────
    ("GET", "/api/earnings/analyst-grades/{ticker}"),
    ("GET", "/api/earnings/call-recap/{ticker}"),
    ("GET", "/api/earnings/sentiment/{ticker}"),
    ("GET", "/api/earnings/transcript/{ticker}"),
    ("GET", "/api/earnings/transcript-quarters/{ticker}"),
    ("GET", "/api/earnings/keyword-alerts"),
    ("POST", "/api/earnings/keyword-alerts"),
    ("DELETE", "/api/earnings/keyword-alerts"),
    # ── Calendar personalization (api/routers/calendar.py) ───────────────────
    ("GET", "/api/calendar/dividends"),
    ("GET", "/api/calendar/export-token"),
    ("GET", "/api/calendar/my-sets"),
    ("GET", "/api/calendar/next-report"),
    ("GET", "/api/calendar/sector-read"),
    ("GET", "/api/calendar/seen"),
    ("POST", "/api/calendar/seen"),
    # ── AI Search — LLM spend on the firm's key (api/routers/ai_search.py) ───
    ("POST", "/api/ai-search"),
    ("POST", "/api/ai-search/signal"),
    ("POST", "/api/ai-search/stream"),
    # ── Flow explain — LLM spend (api/flow_explain.py) ───────────────────────
    ("POST", "/api/flow-explain"),
    ("POST", "/api/flow-explain/"),
    # ── Pattern engine: the last three doors its siblings left open ──────────
    ("GET", "/api/patterns/confirmed/{sym}"),
    ("POST", "/api/patterns/feedback"),
    ("POST", "/api/patterns/{detection_id}/feedback"),
    # ── Per-symbol research relays ───────────────────────────────────────────
    ("GET", "/api/analyst/{sym}"),
    ("GET", "/api/ownership/{sym}"),
    ("GET", "/api/stock-brief/{sym}"),
    ("GET", "/api/news-catalysts/{sym}"),
    # ── Morning Wire replay: PAST issues (api/routers/engine_data.py) ───────
    # TERM-089: the archive of past mornings.
    ("GET", "/api/wire/archive"),
    ("GET", "/api/wire/archive/{ymd}"),
    # ── Morning Wire: TODAY's issue (owner ruling 2026-10-02, TERM-081 / OI-12)
    # "Everything is paywall": these were LEFT_OPEN as the free tier's content
    # until FREE_PAGES was emptied.
    ("GET", "/api/rundown"),
    ("GET", "/api/rundown/speech-text"),
    ("GET", "/api/theme-index/{slug}"),
    ("GET", "/api/single-stock-etfs/{symbol}"),
    ("GET", "/api/research/expected-move/{sym}"),
    ("GET", "/api/fundamentals/earnings-table"),
}

#: ✋ STILL SESSION-ONLY, AND THAT IS PINNED SO IT CHANGES ONLY ON PURPOSE.
#:
#: ⚰️ The reason recorded per row was the free tier: `FREE_PAGES =
#: ['/morning-wire']` and a FREE member walked that page. The owner ruled
#: "everything is paywall" on 2026-10-02 (TERM-081 / OI-12); FREE_PAGES is now
#: empty and the Wire's own content (`/api/rundown*`) moved to PAID_NOW. The
#: rows below are shared reads the same components make on PAID pages too; with
#: no free page left, each is a candidate for a later paid pass, recorded here
#: rather than silently re-justified.
LEFT_OPEN: dict[tuple[str, str], str] = {
    ("GET", "/api/catalysts/today"):
        "`MorningWire.jsx:353` renders <CatalystTable> — it is ON the free page",
    ("GET", "/api/catalysts/by-date/{ymd}"):
        "the same table's date picker (`datePicker` prop, same element)",
    ("GET", "/api/catalysts/explain/{sym}"):
        "the ⓘ citations popover on a row of that table",
    ("GET", "/api/catalysts/my-feedback"):
        "the member's own 👍/👎 on that table",
    ("POST", "/api/catalysts/feedback"):
        "writing that 👍/👎 — the member's own row",
    ("GET", "/api/tweets/feed"):
        "`MorningWire.jsx:99` calls useTweetFeed — it is ON the free page",
    ("GET", "/api/tweets/ticker/{sym}"):
        "the 🐦 rows in MoversSidebar, which MobileNav opens from the free page",
    ("GET", "/api/tweets/has-tweets-batch"):
        "which of those rows get a 🐦 at all — same sheet, same free page",
    ("GET", "/api/community/status"):
        "`NavBar.jsx:56` polls it for EVERY logged-in user, free included; it "
        "returns a feature flag, not proprietary output",
    ("GET", "/api/alerts"):
        "AlertBell in the shell that wraps every page, the free one included",
}

#: ⛔ NEVER DRIVEN WITH A REQUEST, IN EITHER DIRECTION — because the case this
#: file exists to catch is "the gate is gone", and in exactly that case the
#: handler RUNS. What each one runs is money:
NEVER_PROBED: dict[tuple[str, str], str] = {
    ("GET", "/api/earnings/call-recap/{ticker}"):
        "an Opus + Perplexity synthesis on the firm's key",
    ("GET", "/api/earnings/sentiment/{ticker}"):
        "an LLM sentiment read on the firm's key",
    ("GET", "/api/earnings/transcript/{ticker}"):
        "draws on the AlphaVantage 25-calls-a-DAY budget the product shares",
    ("GET", "/api/stock-brief/{sym}"):
        "generates an LLM company description + thematic narrative",
    ("GET", "/api/news-catalysts/{sym}"):
        "runs the web catalyst search behind the merged feed",
    ("GET", "/api/modelbook/year-recap"):
        "MODELBOOK_RECAP_ENABLED defaults to '1', so a miss fires an LLM job",
}

#: Driven for REFUSAL (no body — safe) but never with a paid caller, because the
#: paid pass must send a body and a body is what makes them spend. Their paid
#: direction is covered by `test_every_require_paid_gate_is_a_REAL_paid_check`,
#: which calls the gate object itself.
NEVER_PROBED_PAID: set[tuple[str, str]] = {
    ("POST", "/api/ai-search"),
    ("POST", "/api/ai-search/stream"),
    ("POST", "/api/flow-explain"),
    ("POST", "/api/flow-explain/"),
    # ⛔ AND ONE THAT IS NOT ABOUT MONEY — it is about `C:\data`.
    #
    # A paid probe of this route reaches `single_stock_etfs._ensure_init`, which
    # `os.makedirs`es the parent of its DB path. On this box `/data` resolves to
    # the owner's LIVE `C:\data`, and the repo-root conftest tripwire caught it —
    # correctly, and on the FIRST run, because this test is the first thing that
    # has ever driven the route.
    #
    # 🔎 The redirect missed it for a DERIVABLE reason, recorded here so nobody
    # re-diagnoses it: `conftest.shared_data_root_census` pairs an env var with a
    # literal only when their names share a word, and `_words` drops generic
    # tokens — so `SSETF_DB_PATH` reduces to `{SSETF}` while
    # `single_stock_etfs.db` reduces to `{SINGLE, STOCK, ETFS}`. **The env var is
    # an ACRONYM of the filename**, so they share nothing and the pin is skipped;
    # `/data/single_stock_etfs.db` sits in `UNPINNABLE_SHARED_LITERALS`, where the
    # tripwire is the only protection. Reported rather than hand-patched: adding a
    # typed entry to a DERIVED census would be a second authority over the
    # derivation, which is this repo's most-repeated defect.
    #
    # The gate itself is unaffected — anonymous and free are still driven (they
    # are refused before the handler runs, which is the whole point), and the paid
    # direction is covered by calling the gate object directly.
    ("GET", "/api/single-stock-etfs/{symbol}"),
}

PATH_PARAM_SAMPLES = {
    "sym": "NVDA",
    "symbol": "NVDA",
    "ticker": "NVDA",
    "ymd": "2026-08-08",
    "slug": "ai-infrastructure",
    "name": "VCP",
    "setup_type": "VCP",
    # Deliberately absent ids: a real one would make the Model Book fire its
    # background catalyst generation, and this file must never cause a spend.
    "stock_id": "999999999",
    "example_id": "999999999",
    "detection_id": "no-such-detection",
}

QUERY_PARAM_SAMPLES = {
    "sym": "NVDA",
    "symbol": "NVDA",
    "year": "2025",
    "sector": "Technology",
    "setup": "VCP",
    "setup_type": "VCP",
    "keyword": "guidance",
    "date": "2026-08-08",
    "tickers": "NVDA",
    "entry_price": "100",
    "stop_price": "94",
}

BODY_SAMPLES = {
    ("POST", "/api/calendar/seen"): {"item_type": "earnings", "item_key": "NVDA"},
    ("POST", "/api/earnings/keyword-alerts"): {"keyword": "guidance"},
    ("POST", "/api/patterns/feedback"): {"ticker": "NVDA", "tf": "D",
                                         "setup": "vcp", "rating": "up"},
    ("POST", "/api/patterns/{detection_id}/feedback"): {"rating": "up"},
    ("POST", "/api/ai-search/signal"): {"answer_id": "no-such-answer", "kind": "copy"},
}

REFUSALS = {401, 402, 403}

ANON = None
FREE_USER = {"id": "pg-free-1", "email": "pgfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "pg-paid-1", "email": "pgpaid@example.test", "role": "member", "plan": "pro"}
ADMIN_USER = {"id": "pg-adm-1", "email": "pgadm@example.test", "role": "admin", "plan": "free"}


# ── the derived route table ──────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    """THE REAL APP. Imported, never rebuilt — a locally-constructed `FastAPI()`
    is how `AdminGuardMiddleware` stayed green for months while production had no
    guard at all. Not entered as a context manager: the lifespan would start the
    scheduler and the COT seed, and this file measures routing only."""
    from api.main import app as real_app
    return real_app


def _table(app) -> dict[tuple[str, str], object]:
    out = {}
    for r in app.routes:
        for method in sorted((getattr(r, "methods", None) or set()) - {"HEAD", "OPTIONS"}):
            out[(method, r.path)] = r
    return out


def _dep_names(route) -> set[str]:
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


def _klass_of(route) -> set[str]:
    """`require_paid` is defined PER ROUTER by design (railed by
    `tests/test_user_definitions_auth.py`), so there is no single object to
    compare against and for that class the name is the identity —
    `test_every_require_paid_gate_is_a_REAL_paid_check` is what proves each such
    function really consults `is_paid_user` instead of merely being called that."""
    names = _dep_names(route)
    out = set()
    if "require_paid" in names:
        out.add("paid")
    if get_current_user in _dep_objects(route):
        out.add("session")
    return out


def _request_for(route, key, *, with_body: bool):
    method, path = key
    declared = set(re.findall(r"\{(\w+)\}", path))
    missing = declared - set(PATH_PARAM_SAMPLES)
    assert not missing, (
        f"{method} {path} declares path params {sorted(missing)} with no sample — "
        "add them or the sweep silently 404s instead of measuring the gate")
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


def _client(app, user):
    """⚠️ THE OVERRIDES ARE ON `get_current_user` / `get_current_user_with_plan`,
    NEVER on `require_paid` — overriding a gate means the test never runs the
    gate (`lesson_injected_dependency_hides_the_fetch`). `user=None` overrides
    nothing, so an anonymous caller walks the real cookie path.

    ⛔ `raise_server_exceptions=False` is deliberate and is not leniency: a
    handler that throws because a store is absent on a dev box would otherwise
    fail this file for a DATA reason, and the fix someone reaches for then is to
    weaken the sweep. As a 500 it is simply "not a refusal", which is true."""
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    client = TestClient(app, raise_server_exceptions=False)
    if user is not None:
        client.cookies.set("uct_session", "test-session")
    return client


@pytest.fixture
def clean_overrides(app):
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


# ── 1. the tables are real ───────────────────────────────────────────────────

def test_every_route_this_file_names_EXISTS_on_the_real_app(app):
    """⛔ THE LIST IS A CLAIM; THE APP IS THE MEASUREMENT.

    A table naming routes the app no longer mounts is the failure mode that lets
    a whole file pass while guarding nothing. Both tables are resolved against
    `api.main:app`, and the table itself is asserted non-trivial so a broken walk
    cannot pass by finding zero."""
    table = _table(app)
    assert len(table) > 500, f"the route walk found only {len(table)} routes"
    for label, keys in (("PAID_NOW", PAID_NOW),
                        ("LEFT_OPEN", set(LEFT_OPEN)),
                        ("NEVER_PROBED", set(NEVER_PROBED)),
                        ("NEVER_PROBED_PAID", NEVER_PROBED_PAID)):
        missing = sorted(k for k in keys if k not in table)
        assert not missing, (
            f"{label} names {missing}, which the app does not mount — either a "
            "route was renamed (update this table WITH the rename) or a router "
            "stopped mounting, which is the bigger problem")
    assert set(NEVER_PROBED) <= PAID_NOW
    assert NEVER_PROBED_PAID <= PAID_NOW
    assert not (set(NEVER_PROBED) & NEVER_PROBED_PAID), (
        "a route cannot be both never-probed and probed-for-refusal-only")


def test_the_gate_reader_can_report_UNGATED(app):
    """⭐ THE CONTROL ON THE CHECKER ITSELF. Every structural assertion below is
    "this route carries this gate"; a reader that had stopped seeing
    dependencies, or that returned a class for everything, would satisfy all of
    them. `GET /api/health` is Railway's `healthcheckPath` — public by design,
    and therefore a stable control."""
    assert _klass_of(_table(app)[("GET", "/api/health")]) == set(), (
        "the deliberately-public health check reports a gate — the class reader "
        "is returning classes it did not find")


# ── 2. the structural half ───────────────────────────────────────────────────

@pytest.mark.parametrize("key", sorted(PAID_NOW), ids=lambda k: f"{k[0]} {k[1]}")
def test_every_gated_route_carries_require_paid_in_its_DEPENDENCY_TREE(app, key):
    """Read off `route.dependant`, never off the source text. A decorator on the
    wrong router object, a handler defined but never mounted, a router-level
    dependency someone hoisted — the source says one thing and the served app
    another. This reads the served app."""
    found = _klass_of(_table(app)[key])
    assert "paid" in found, (
        f"{key[0]} {key[1]} was gated as paid and the app reports "
        f"{sorted(found) or 'NO GATE AT ALL'} — this route is open again")


@pytest.mark.parametrize("key", sorted(LEFT_OPEN), ids=lambda k: f"{k[0]} {k[1]}")
def test_every_route_left_open_is_STILL_session_only(app, key):
    """✋ THE OTHER DIRECTION, AND IT MATTERS AS MUCH.

    These are the free tier. A later sweep that paywalls one of them closes the
    top of the funnel, and it would do it while looking like an improvement. So
    "still open" is asserted as deliberately as "now closed" — with the reason
    carried in the failure message, so whoever trips it reads the argument rather
    than re-deriving it."""
    found = _klass_of(_table(app)[key])
    assert "paid" not in found, (
        f"{key[0]} {key[1]} is now PAID, but it is on the FREE tier: "
        f"{LEFT_OPEN[key]}. FREE_PAGES = ['/morning-wire'] and this is part of "
        "that page — paywalling it is a funnel outage, not a tightening.")
    assert "session" in found, (
        f"{key[0]} {key[1]} lost its session gate entirely — it is anonymous "
        "again, which is the crawler hole, not the free tier")


def test_every_require_paid_gate_is_a_REAL_paid_check(app):
    """⛔ "NAMED `require_paid`" IS NOT "CHECKS PAYMENT".

    `require_paid` is defined once per router by design, so the structural test
    above can only match it by NAME — and a name is exactly what a regression can
    keep while changing what the function does. Each distinct gate object
    reachable from a route here is CALLED with a free member (must raise 402),
    with a paid member and with an admin (must not), and their sentences must be
    distinct so a member can tell which surface refused them.

    ⭐ This is also the PAID half for `NEVER_PROBED` / `NEVER_PROBED_PAID`: those
    routes are never driven with a spending request, but their gate is exercised
    in both directions right here."""
    from fastapi import HTTPException

    gates = {}
    for key in PAID_NOW:
        for dep in _dep_objects(_table(app)[key]):
            if getattr(dep, "__name__", "") == "require_paid":
                gates.setdefault(dep, []).append(key)

    assert len(gates) >= 12, (
        f"only {len(gates)} distinct require_paid gates found across {len(PAID_NOW)} "
        "routes — either the walk is not reaching them, or a shared gate was "
        "invented (which changes other routers' behaviour as a side effect)")

    sentences = {}
    for gate in gates:
        with pytest.raises(HTTPException) as exc:
            gate(dict(FREE_USER))
        assert exc.value.status_code == 402, (gate, exc.value.status_code)
        sentences.setdefault(exc.value.detail, []).append(gate.__module__)
        assert gate(dict(PAID_USER)) is not None
        assert gate(dict(ADMIN_USER)) is not None

    dupes = {s: m for s, m in sentences.items() if len(m) > 1}
    assert not dupes, (
        f"these routers refuse with the SAME sentence, so a member cannot tell "
        f"which surface locked them out: {dupes}")


# ── 3. the behavioural half: anonymous, then free ────────────────────────────

def test_an_ANONYMOUS_caller_is_refused_on_every_safely_probeable_route(app, clean_overrides):
    """No overrides and no body — the real cookie path with an empty jar.

    Dependencies are solved before request-body validation, so a gated route
    refuses whatever it was or was not sent, while an UNGATED one answers 422 (or
    200) and is caught here. That ordering is also what makes it safe to probe
    the AI-Search and flow-explain POSTs: with no body, an ungated handler is
    never entered."""
    client = _client(app, ANON)
    table = _table(app)
    probed = 0
    for key in sorted(PAID_NOW):
        if key in NEVER_PROBED:
            continue
        url, kwargs = _request_for(table[key], key, with_body=False)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code in REFUSALS, (
            f"{key[0]} {key[1]} answered an ANONYMOUS caller "
            f"{resp.status_code} — {resp.text[:200]}")
        probed += 1
    assert probed == len(PAID_NOW) - len(NEVER_PROBED), probed


def test_the_harness_would_have_SEEN_an_open_door(app, clean_overrides):
    """⭐ THE CONTROL ON THE REFUSAL SWEEP. A sweep that refuses everything is
    also what a broken client or a 500ing app produces. The same anonymous client
    is driven at a deliberately-open route and must get a NON-refusal — which is
    what makes every refusal above evidence of a gate."""
    resp = _client(app, ANON).get("/api/health")
    assert resp.status_code not in REFUSALS, (
        f"the public health check refused an anonymous caller ({resp.status_code}) "
        "— the harness is not measuring gates, it is failing")


def test_a_FREE_member_is_refused_402_on_every_gated_route(app, clean_overrides):
    """🔴 THE FINDING ITSELF, MEASURED. "Logged in" is not "paid". Signup is open
    and free, so before this change every one of these was a free registration
    away — and the 401 sweep would never have noticed, because a free member IS
    authenticated. This is the assertion the old gate could not make."""
    client = _client(app, FREE_USER)
    table = _table(app)
    checked = 0
    for key in sorted(PAID_NOW):
        if key in NEVER_PROBED:
            continue
        url, kwargs = _request_for(table[key], key, with_body=False)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code == 402, (
            f"{key[0]} {key[1]} answered a logged-in FREE member "
            f"{resp.status_code} — {resp.text[:200]}")
        checked += 1
    assert checked >= 45, checked


# ── 4. the half that tells a gate from an outage ─────────────────────────────

def test_a_PAID_member_is_NOT_refused_on_any_route_gated_here(app, clean_overrides):
    """⚠️ A sweep of refusals is satisfied by a router that refuses everybody.

    ⛔ NOT asserted as 200: several of these read stores that are empty or absent
    on a dev box (modelbook.db, pattern_vision, the intelligence pack), and a
    404/503 from an empty store is a DATA fact, not an AUTH fact. Collapsing the
    two makes this file go red for the wrong reason and get "fixed" by loosening
    the thing it protects. The control below keeps that honest."""
    client = _client(app, PAID_USER)
    table = _table(app)
    driven = 0
    for key in sorted(PAID_NOW):
        if key in NEVER_PROBED or key in NEVER_PROBED_PAID:
            continue
        url, kwargs = _request_for(table[key], key, with_body=True)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code not in REFUSALS, (
            f"{key[0]} {key[1]} REFUSED a paid member with {resp.status_code} — "
            f"the gate became an outage: {resp.text[:300]}")
        driven += 1
    assert driven >= 40, driven


def test_the_paid_pass_produces_REAL_successes_not_just_absence_of_refusal(
        app, clean_overrides):
    """⭐ THE CONTROL ON THE PAID SWEEP. "Not refused" is satisfied by an app that
    500s uniformly, so the paid pass must have produced a healthy number of real
    200s for the assertion above to rest on anything."""
    client = _client(app, PAID_USER)
    table = _table(app)
    ok = []
    for key in sorted(PAID_NOW):
        if key in NEVER_PROBED or key in NEVER_PROBED_PAID:
            continue
        url, kwargs = _request_for(table[key], key, with_body=True)
        if client.request(key[0], url, **kwargs).status_code == 200:
            ok.append(key)
    assert len(ok) >= 15, (
        f"only {len(ok)} of the gated routes answered a paid member 200 — the "
        f"paid sweep is not exercising real handlers: {ok}")


# ── 5. THE FREE TIER, WHICH A PAYWALL FIX MUST NOT BREAK ─────────────────────

def test_a_FREE_member_is_refused_the_MORNING_WIRE_itself(app, clean_overrides):
    """⭐ OWNER RULING 2026-10-02 (TERM-081 / OI-12): "Everything is paywall".

    ⚰️ This was THE FUNNEL REGRESSION TEST, requiring a free member to get 200
    on the two rundown routes: the Wire was the one free page. The ruling
    emptied FREE_PAGES, so the content now refuses a free member with the
    router's own 402 sentence. The session-only LEFT_OPEN rows must still merely
    not be REFUSED (they are pinned as session-only; on a dev box their stores
    are empty and an empty store is a data fact, not an auth fact)."""
    client = _client(app, FREE_USER)

    for path in ("/api/rundown", "/api/rundown/speech-text"):
        resp = client.get(path)
        assert resp.status_code == 402, (
            f"{path} answered a FREE member {resp.status_code} — the Morning Wire "
            f"is paid since 2026-10-02: {resp.text[:200]}")
        assert resp.json()["detail"] == "The daily wire surface requires a paid plan"

    table = _table(app)
    for key, why in sorted(LEFT_OPEN.items()):
        url, kwargs = _request_for(table[key], key, with_body=True)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code not in REFUSALS, (
            f"{key[0]} {key[1]} refused a FREE member {resp.status_code}, but it "
            f"is on the free journey: {why}. {resp.text[:200]}")


def test_the_free_tier_routes_still_refuse_an_ANONYMOUS_caller(app, clean_overrides):
    """✋ "Free" is not "public". These stay behind a session — the crawler hole
    the previous pass closed on the rundown must not reopen just because this
    pass decided not to paywall them."""
    client = _client(app, ANON)
    table = _table(app)
    for key in sorted(LEFT_OPEN):
        url, kwargs = _request_for(table[key], key, with_body=False)
        resp = client.request(key[0], url, **kwargs)
        assert resp.status_code in REFUSALS, (
            f"{key[0]} {key[1]} answered an ANONYMOUS caller {resp.status_code} "
            f"— it is free-tier, not public")


# ── 6. the reach is DERIVED from the frontend, not remembered ────────────────

_IMPORT_RE = re.compile(
    r"""(?:^|\n)\s*import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]"""
    r"""|import\(\s*['"]([^'"]+)['"]\s*\)""")
_EXTS = ("", ".jsx", ".js", ".ts", ".tsx", "/index.jsx", "/index.js")
#: ⛔ Only SOURCE is walked. `import mark from './assets/compass-mark.png'` and
#: `import styles from './X.module.css'` are real edges Vite resolves, but they
#: carry no route literals and a PNG is not utf-8 — reading one crashed this walk
#: before the filter existed, which would have been a green-by-absence failure.
_SOURCE_EXTS = (".jsx", ".js", ".ts", ".tsx")


def _resolve(spec: str, importer: str) -> str | None:
    if spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    elif spec.startswith("@/"):
        base = os.path.normpath(os.path.join(SRC, spec[2:]))
    elif spec.startswith("/src/"):
        base = os.path.normpath(os.path.join(SRC, spec[5:]))
    else:
        return None                      # a bare package specifier
    for ext in _EXTS:
        candidate = base + ext
        if os.path.isfile(candidate) and candidate.endswith(_SOURCE_EXTS):
            return candidate
    return None


def _module_tree(entries: list[str]) -> dict[str, str | None]:
    """Every file reachable from `entries`, mapped to its importer.

    ⛔ AN IMPORT WALK, NOT A GREP. A grep over `app/src` for `/api/analyst/`
    reports every file that MENTIONS it — comments, tests, dead components — and
    a grep on this branch has already manufactured a ship-blocker out of three
    prose hits. This follows real edges, static and `lazy(() => import())` alike,
    which is how `TickerPopup`'s lazily-imported panels are found at all."""
    parent: dict[str, str | None] = {}
    queue = []
    for entry in entries:
        path = os.path.join(SRC, entry)
        assert os.path.isfile(path), f"entry point {entry} does not exist"
        parent[path] = None
        queue.append(path)
    while queue:
        current = queue.pop(0)
        try:
            src = open(current, encoding="utf-8").read()
        except OSError:
            continue
        for match in _IMPORT_RE.finditer(src):
            target = _resolve(match.group(1) or match.group(2), current)
            if target and target not in parent:
                parent[target] = current
                queue.append(target)
    return parent


#: The routes in `PAID_NOW` that a FREE member's Morning Wire tree can still
#: reach, each with the verdict that was taken on it. Derived below and asserted
#: EQUAL — a new one appearing means somebody put a paywalled surface on the free
#: page, and the judgement has to be made again rather than inherited.
REACHED_FROM_FREE_PAGE = {
    "/api/analyst/":
        "TickerPopup's Analyst tab. FMP Ultimate data on paid surfaces; the tab "
        "is two clicks past the free content, and `useAnalystIntel` now reports "
        "a refusal so the panel says so instead of spinning forever.",
    "/api/ownership/":
        "TickerPopup's Ownership tab. Same call, same treatment in "
        "`useOwnership` + `OwnershipPanel`.",
    "/api/theme-index/":
        "TickerPopup -> ChartPane -> useThemeIndexBars, which fires ONLY for a "
        "'$IDX:<slug>' pseudo-ticker. A ticker chip on Morning Wire is never "
        "one, so no free member's request actually reaches it.",
    "/api/patterns/feedback":
        "TickerPopup -> StockChart -> PatternSidePanel, which renders only for "
        "an `activeDetection` — and detections come from /api/patterns/{sym}, "
        "already paid since 9ff74f69. A free member has nothing to vote on.",
    "/api/patterns/":
        "the SAME reach, reported coarsely because `{detection_id}` is the first "
        "path segment of POST /api/patterns/{detection_id}/feedback, so its "
        "static prefix is the whole family. Left coarse on purpose: a prefix "
        "that over-matches makes this rail MORE sensitive, and tuning a matcher "
        "until it agrees with the list it is supposed to check is how a guard "
        "stops guarding.",
    # ⚰️ 2026-09-25, found by PR #186's CI run: five more routes became reachable from
    # the FREE page's IMPORT graph in one hop -- Layout -> CommandPalette -> useJ2Notes
    # (the wave-5 schema guard, 8167f7aa0) -> lib/notebookSchema.js -> `import('./tiptap')`
    # -> widgetEmbedNode -> the three widget embeds -> the /charts widgets that fetch
    # them. The edge into the editor is DYNAMIC (notebookSchema.js:138), so no free page
    # LOADS the editor for it; this walk follows lazy edges on purpose and reports it.
    # The verdict, made out loud: the Journal is itself a free page, so a free member
    # could already reach these same widgets by opening any note; each route stays
    # require_paid and the 402 is proved by this file's own free-member test; and a
    # live embed whose fetch fails falls to the error boundary WidgetEmbedView.jsx
    # keeps for exactly that (its archived image), never a spinner.
    "/api/ai-search":
        "AiSearchEmbed -> AiSearchWidget, reached from the free shell only through "
        "the command palette's schema guard and a lazy editor import. A free member's "
        "fetch is refused 402 and the embed shows its archived image.",
    "/api/ai-search/signal":
        "Same widget, same reach, same refusal.",
    "/api/ai-search/stream":
        "Same widget, same reach, same refusal.",
    "/api/fundamentals/earnings-table":
        "FundamentalsEmbed -> FundamentalsWidget -> useEarningsTable; same reach, "
        "same 402, archived image on the free tier.",
    "/api/news-catalysts/":
        "NewsEmbed -> NewsWidget -> useNewsCatalysts; same reach, same refusal.",
    # TERM-089 (2026-09-28): the Morning Wire page itself mounts WireArchive, the
    # replay of PAST issues. Verdict, made out loud: today's wire stays free, past
    # issues are paid. The component renders NOTHING and fetches NOTHING unless
    # `useIsPaid()` is true (WireArchive.test.jsx asserts no request for a free
    # member), so a free member's page never sends the 402 this file proves.
    "/api/wire/archive":
        "WireArchive on /morning-wire, rendered and fetched only for a paid "
        "member; a free member sees today's wire exactly as before.",
    "/api/wire/archive/":
        "Same component, the by-date read behind its date picker; same gate.",
    # ⭐ 2026-10-02, TERM-081 / OI-12 ("everything is paywall"): the Wire's OWN
    # content. This walk still starts at pages/MorningWire.jsx, but no free member
    # renders that page any more: FREE_PAGES is empty and AuthGuard sends a
    # non-paid member to /subscribe before the page mounts.
    "/api/rundown":
        "MorningWire.jsx's own content; paid like the page itself since "
        "2026-10-02, and a free member never mounts the page.",
    "/api/rundown/speech-text":
        "Read Aloud of the same rundown, on the same now-paid page.",
    # ⚰️ Red on integrate/terminal-fixes before this lane: Notebook wave 11
    # (#263, 2026-10-02) added ModelBookEmbed, reached through the same lazy
    # editor import as the widget embeds above. Verdict, made out loud: each stays
    # require_paid, and since 2026-10-02 there is no free page at all, so no free
    # member walks this tree.
    "/api/modelbook/stocks":
        "ModelBookEmbed in the Notebook editor (lazy import); paid, and no free "
        "member renders the shell since the 2026-10-02 ruling.",
    "/api/modelbook/stock/":
        "Same embed, the per-stock read; same gate, same reach.",
}


def test_nothing_NEW_on_the_free_page_became_paid_without_a_recorded_verdict():
    """⭐ THE WIRE TEST — it goes RED when the free page starts calling something
    this file paywalled, while every component stays individually correct.

    The morning-wire component tree is WALKED (`pages/MorningWire.jsx` plus the
    shell that renders around every page), the `/api/...` literals in it are
    collected, and each one that this task gated must have a recorded verdict
    above. A tile added to the free page tomorrow that fetches the Model Book
    fails here — which is the only place it would fail, because the tile and the
    gate would both be correct on their own (`lesson_built_tested_green_and_
    unreachable`)."""
    tree = _module_tree([
        "pages/MorningWire.jsx",
        "components/Layout.jsx",
        "components/AuthGuard.jsx",
        "components/NavBar.jsx",
        "components/MobileNav.jsx",
        "components/mobile/MoreSheet.jsx",
    ])

    # CONTROLS — a walk that resolved nothing would pass this test by finding no
    # reachable route at all, which is the vacuous-guard shape this repo keeps
    # re-committing. Both a size floor and a specific LAZY edge are required.
    assert len(tree) > 150, f"the import walk resolved only {len(tree)} files"
    assert os.path.join(SRC, "components", "TickerPopup.jsx") in tree, (
        "the walk did not reach TickerPopup — the static edges are not resolving")
    assert os.path.join(SRC, "components", "fundamentals", "AnalystPanel.jsx") in tree, (
        "the walk did not follow lazy(() => import(...)) into AnalystPanel — it "
        "is measuring less than the browser loads, so its silence means nothing")

    literals = set()
    for path in tree:
        try:
            src = open(path, encoding="utf-8").read()
        except OSError:
            continue
        literals.update(re.findall(r"""['"`](/api/[A-Za-z0-9_\-/]*)""", src))

    gated_prefixes = set()
    for _method, path in PAID_NOW:
        gated_prefixes.add(path.split("{", 1)[0])

    reached = {p for p in gated_prefixes
               if any(lit.startswith(p) and len(lit) >= len(p) - 1 for lit in literals)}
    # `/api/patterns/feedback` is a literal, not a prefix-with-param.
    reached |= {p for p in gated_prefixes if p.rstrip("/") in literals}

    assert reached == set(REACHED_FROM_FREE_PAGE), (
        "the set of paywalled routes the FREE Morning Wire page can reach has "
        f"changed.\n  newly reachable: {sorted(reached - set(REACHED_FROM_FREE_PAGE))}\n"
        f"  no longer reachable: {sorted(set(REACHED_FROM_FREE_PAGE) - reached)}\n"
        "Each one needs a verdict recorded in REACHED_FROM_FREE_PAGE — a free "
        "member walks this tree, and 'it is behind a click' is a judgement "
        "somebody has to make out loud, not inherit.")


def test_the_two_panels_a_free_member_can_still_open_report_a_REFUSAL(app):
    """⛔ A PAYWALL THAT LOOKS LIKE A HANG IS A BUG, NOT A PAYWALL.

    `AnalystPanel` rendered a skeleton and `OwnershipPanel` rendered
    "Loading NVDA…" whenever their hook returned `null` — and the hooks collapsed
    EVERY non-`ok` response to `null`. Gating `/api/analyst` and `/api/ownership`
    without touching them would have shown a free member on the free page a
    loading state that never resolves.

    Asserted on the SOURCE because these are the two files the fix lives in and
    there is no JS runtime in this suite; the vitest lane owns behaviour. The
    check is not "the word appears": it is that each hook distinguishes a refusal
    status from a failure, and that each panel branches on the sentinel."""
    for hook, sentinel in (("useAnalystIntel.js", "ANALYST_LOCKED"),
                           ("useOwnership.js", "OWNERSHIP_LOCKED")):
        src = open(os.path.join(SRC, "hooks", hook), encoding="utf-8").read()
        assert "402" in src, f"{hook} does not distinguish a paywall refusal"
        assert sentinel in src, f"{hook} lost its refusal sentinel"

    for panel in ("AnalystPanel.jsx", "OwnershipPanel.jsx"):
        src = open(os.path.join(SRC, "components", "fundamentals", panel),
                   encoding="utf-8").read()
        assert "data?.locked" in src, (
            f"{panel} no longer branches on the refusal sentinel — a free member "
            "gets a loading state that never resolves")
        assert "paid plan" in src, f"{panel} refuses without saying why"


# ── 7. THE NOTEBOOK: every member route in a Notebook router is paid ─────────
#
# Owner ruling 2026-10-02 ("no free tier, everything is paywall"), applied to the
# Notebook by the security review of waves 12 to 15 (finding I-7): about twenty
# new member routes were session-only while their siblings were paid, with no
# rule behind the split and nothing railing it either way.
#
# THE SET IS DERIVED, NOT TYPED. Every route the real app serves whose handler
# lives in an `api.routers.notebook_*` module is classified from its dependency
# tree. It must be paid, or admin-only, or be named in `NOTEBOOK_NOT_PAID` with
# the reason. So a Notebook route added tomorrow with only a session check fails
# here BY NAME, whatever it is called and whichever router it lands in.

NOTEBOOK_MODULE_PREFIX = "api.routers.notebook_"

#: The routes the ruling closed, named, so each is asserted on its own and a
#: rename is loud. Each was session-only at `72715e8001`.
NOTEBOOK_PAID_BY_RULING: set[tuple[str, str]] = {
    ("GET", "/api/j2/template-gallery"),
    ("GET", "/api/j2/template-gallery/{gallery_id}"),
    ("POST", "/api/j2/template-gallery/{gallery_id}/use"),
    ("POST", "/api/j2/template-gallery/{gallery_id}/report"),
    ("GET", "/api/j2/plan-grades/trades/{trade_id}"),
    ("POST", "/api/j2/plan-grades/trades/{trade_id}/relink"),
    ("GET", "/api/j2/plan-grades/status"),
    ("GET", "/api/j2/plan-grades/discipline"),
    ("GET", "/api/j2/my-playbook"),
    ("GET", "/api/j2/review-drafts/daily"),
    ("GET", "/api/j2/review-drafts/weekly"),
    ("GET", "/api/j2/review-drafts/monthly"),
    ("GET", "/api/j2/setups-board"),
    ("GET", "/api/j2/notebook-visual-playbook/trades/{trade_id}/before-after"),
    ("POST", "/api/j2/chart-plan/size"),
    ("GET", "/api/j2/chart-plan/benchmarks"),
    ("POST", "/api/j2/chart-plan/alerts"),
    ("PUT", "/api/j2/onboarding/tours/{tour_id}"),
}

#: The flags that keep those routes dark. Turned on for the behavioural sweep
#: only: with a flag off every caller gets the one 404, which says nothing about
#: the plan gate.
NOTEBOOK_RULING_FLAGS = (
    "NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "NOTEBOOK_PLAN_GRADING_ENABLED", "NOTEBOOK_PLAYBOOK_ENABLED",
    "NOTEBOOK_REVIEW_DRAFTS_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED",
    "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED", "NOTEBOOK_CHART_PLAN_ENABLED", "NOTEBOOK_ONBOARDING_ENABLED",
)

#: ✋ NOT PAID, AND PINNED SO THAT CHANGES ONLY ON PURPOSE. None of these is new
#: in waves 12 to 15; each predates the scope the ruling was applied to here.
_PUBLIC = "a public page: a stranger opens a share link or a published note with no account"
_BEARER = "its own bearer token, not a session (the personal API); minting a token is paid"
#: ⛔ OWNER RULING 2026-10-07: a member must ALWAYS be able to take their own content down,
#: whatever their plan. A takedown is never paywalled. Each of the nineteen routes the
#: paywall ruling closed was checked against this; only one of them does nothing but remove
#: the caller's own content (see docs/notebook/fin-sec.md for the other eighteen).
_TAKEDOWN = ("a member can ALWAYS take their own content down, whatever their plan (owner "
             "ruling 2026-10-07); this route only removes the caller's own published copy")
_OLDER = ("older than waves 12 to 15 and outside the scope the ruling was applied to in that "
          "review; session-only, a candidate for a later paid pass")
NOTEBOOK_NOT_PAID: dict[tuple[str, str], str] = {
    ("GET", "/api/j2/published/{slug}"): _PUBLIC,
    ("GET", "/api/j2/published/{slug}/att/{sub}/{filename}"): _PUBLIC,
    ("GET", "/api/j2/published/{slug}/n/{pid}"): _PUBLIC,
    ("GET", "/api/j2/published/{slug}/n/{pid}/att/{sub}/{filename}"): _PUBLIC,
    ("GET", "/api/j2/shared/{token}"): _PUBLIC,
    ("GET", "/api/j2/shared/{token}/att/{sub}/{filename}"): _PUBLIC,
    ("POST", "/api/j2/inbound-email"): "the mail provider's webhook, authenticated by its own secret",
    ("POST", "/api/j2/personal/daily/append"): _BEARER,
    ("POST", "/api/j2/personal/notes"): _BEARER,
    ("POST", "/api/j2/personal/notes/{note_id}/append"): _BEARER,
    ("DELETE", "/api/j2/notes/{note_id}/share"): _OLDER + " (turning a share link off)",
    ("GET", "/api/j2/notes/{note_id}/share"): _OLDER,
    ("GET", "/api/j2/share/links"): _OLDER,
    ("DELETE", "/api/j2/publish/{slug}"): _OLDER + " (taking a published page down)",
    ("GET", "/api/j2/publish"): _OLDER,
    ("DELETE", "/api/j2/personal/tokens/{token_id}"): _OLDER + " (revoking a token)",
    ("GET", "/api/j2/personal/tokens"): _OLDER,
    ("DELETE", "/api/j2/onboarding/sample-notebook"): _OLDER + " (removing the sample notebook)",
    ("GET", "/api/j2/onboarding/sample-notebook"): _OLDER,
    ("GET", "/api/j2/ai-actions"): _OLDER,
    ("GET", "/api/j2/ai-actions/{set_id}"): _OLDER,
    ("POST", "/api/j2/ai-actions/{set_id}/apply"): _OLDER,
    ("POST", "/api/j2/ai-actions/{set_id}/undo"): _OLDER,
    ("GET", "/api/j2/export/notebook"): _OLDER + " (a member's own data, on its way out)",
    ("GET", "/api/j2/export/notes/{note_id}"): _OLDER + " (a member's own data, on its way out)",
    ("GET", "/api/j2/link-preview"): _OLDER,
    ("DELETE", "/api/j2/template-gallery/{gallery_id}"): _TAKEDOWN,
    ("GET", "/api/j2/notes/tasks"): _OLDER,
    ("GET", "/api/j2/notes/{note_id}/unlinked-mentions"): _OLDER,
}

NOTEBOOK_PATH_SAMPLES = {"gallery_id": "no-such-template", "trade_id": "no-such-trade", "tour_id": "sec-tour"}


def _notebook_routes(app) -> dict[tuple[str, str], object]:
    return {key: r for key, r in _table(app).items()
            if (getattr(getattr(r, "endpoint", None), "__module__", "") or "").startswith(NOTEBOOK_MODULE_PREFIX)}


def _notebook_class(route) -> str:
    names = _dep_names(route)
    if "require_admin" in names:
        return "admin"
    if "require_paid" in names:
        return "paid"
    return "open"


def test_every_NOTEBOOK_member_route_is_paid_or_named_as_an_exception(app):
    """⭐ THE RAIL. Derived from the served app: a Notebook route that is neither paid nor
    admin-only must be in `NOTEBOOK_NOT_PAID`, by name, with its reason."""
    routes = _notebook_routes(app)
    assert len(routes) >= 80, f"the Notebook route walk found only {len(routes)} routes"
    classes = {key: _notebook_class(r) for key, r in routes.items()}
    assert sum(1 for c in classes.values() if c == "paid") >= 40
    assert any(c == "admin" for c in classes.values()) and any(c == "open" for c in classes.values()), (
        "the classifier reports one class for everything, so it is not reading the gates")

    unpaid = {key for key, c in classes.items() if c == "open"}
    new_open = sorted(unpaid - set(NOTEBOOK_NOT_PAID))
    assert not new_open, (
        "these Notebook routes check a session but not a paid plan, and are not named as "
        f"exceptions: {[f'{m} {p}' for m, p in new_open]}. Owner ruling 2026-10-02: there is no "
        "free tier. Give each this router's own `require_paid`, or add it to "
        "NOTEBOOK_NOT_PAID with the reason.")
    stale = sorted(set(NOTEBOOK_NOT_PAID) - unpaid)
    assert not stale, (
        f"NOTEBOOK_NOT_PAID names routes that are now paid, admin-only or gone: "
        f"{[f'{m} {p}' for m, p in stale]}. Remove the row with the change that closed it.")


@pytest.mark.parametrize("key", sorted(NOTEBOOK_PAID_BY_RULING), ids=lambda k: f"{k[0]} {k[1]}")
def test_each_route_the_ruling_closed_carries_require_paid(app, key):
    routes = _notebook_routes(app)
    assert key in routes, f"{key[0]} {key[1]} is not served by a Notebook router any more"
    assert _notebook_class(routes[key]) == "paid", (
        f"{key[0]} {key[1]} is open to a member with no paid plan again")
    assert key not in NOTEBOOK_NOT_PAID


def _notebook_request(key):
    url = key[1]
    for name in re.findall(r"\{(\w+)\}", url):
        assert name in NOTEBOOK_PATH_SAMPLES, f"no sample for path parameter {name!r}"
        url = url.replace("{" + name + "}", NOTEBOOK_PATH_SAMPLES[name])
    return url


@pytest.fixture
def notebook_flags_on(monkeypatch):
    for flag in NOTEBOOK_RULING_FLAGS:
        monkeypatch.setenv(flag, "1")


def test_a_FREE_member_is_refused_402_on_every_route_the_ruling_closed(app, clean_overrides, notebook_flags_on):
    """Driven with NO body: a refused request never reaches a handler, so nothing is written
    and nothing is spent. The sentence must say a paid plan is needed."""
    client = _client(app, FREE_USER)
    for key in sorted(NOTEBOOK_PAID_BY_RULING):
        resp = client.request(key[0], _notebook_request(key))
        assert resp.status_code == 402, (
            f"{key[0]} {key[1]} answered a logged-in FREE member {resp.status_code}: {resp.text[:200]}")
        assert "paid plan" in resp.json()["detail"], resp.text[:200]


def test_an_ANONYMOUS_caller_is_refused_on_every_route_the_ruling_closed(app, clean_overrides, notebook_flags_on):
    client = _client(app, ANON)
    for key in sorted(NOTEBOOK_PAID_BY_RULING):
        resp = client.request(key[0], _notebook_request(key))
        assert resp.status_code == 401, f"{key[0]} {key[1]} answered an anonymous caller {resp.status_code}"


def test_CONTROL_with_the_flags_off_the_same_requests_are_not_plan_refusals(app, clean_overrides, monkeypatch):
    """The 402s above come from the plan gate and not from the harness: with the flags off the
    same free member gets the dark 404 on every one of them."""
    for flag in NOTEBOOK_RULING_FLAGS:
        monkeypatch.delenv(flag, raising=False)
    client = _client(app, FREE_USER)
    for key in sorted(NOTEBOOK_PAID_BY_RULING):
        assert client.request(key[0], _notebook_request(key)).status_code == 404, key


#: The takedowns: routes whose only effect is removing the caller's own content.
NOTEBOOK_TAKEDOWNS = {key for key, why in NOTEBOOK_NOT_PAID.items() if why is _TAKEDOWN}


def test_a_TAKEDOWN_is_never_paywalled_but_still_needs_a_session(app, clean_overrides, notebook_flags_on):
    """⭐ OWNER RULING 2026-10-07. A member whose plan lapsed reaches the handler (here it
    answers 404, because the sample id names no template of theirs), and a signed-out caller
    is still refused. Paid here would be a member unable to withdraw what they published."""
    assert NOTEBOOK_TAKEDOWNS == {("DELETE", "/api/j2/template-gallery/{gallery_id}")}
    routes = _notebook_routes(app)
    for key in sorted(NOTEBOOK_TAKEDOWNS):
        assert _notebook_class(routes[key]) == "open", f"{key[0]} {key[1]} is paywalled: a takedown never is"
        assert get_current_user in _dep_objects(routes[key]), f"{key[0]} {key[1]} lost its session check"
        url = _notebook_request(key)
        free = _client(app, FREE_USER).request(key[0], url)
        assert free.status_code not in REFUSALS, (
            f"{key[0]} {key[1]} refused a FREE member {free.status_code}: {free.text[:160]}")
        assert _client(app, ANON).request(key[0], url).status_code == 401


def test_every_NOTEBOOK_require_paid_gate_is_a_REAL_paid_check(app):
    """The paid half, and the proof that "named require_paid" means "checks the plan": each
    gate object on a Notebook route is called with a free member (402), a paid member and an
    admin (both pass)."""
    from fastapi import HTTPException

    gates = {}
    for key, route in _notebook_routes(app).items():
        for dep in _dep_objects(route):
            if getattr(dep, "__name__", "") == "require_paid":
                gates.setdefault(dep, []).append(key)
    assert len(gates) >= 14, f"only {len(gates)} distinct Notebook require_paid gates found"
    reached = {key for keys in gates.values() for key in keys}
    assert NOTEBOOK_PAID_BY_RULING <= reached

    sentences: dict[str, list[str]] = {}
    for gate in gates:
        with pytest.raises(HTTPException) as exc:
            gate(dict(FREE_USER))
        assert exc.value.status_code == 402, (gate.__module__, exc.value.status_code)
        sentences.setdefault(exc.value.detail, []).append(gate.__module__)
        assert gate(dict(PAID_USER)) is not None
        assert gate(dict(ADMIN_USER)) is not None
    dupes = {s: m for s, m in sentences.items() if len(m) > 1}
    assert not dupes, f"two Notebook routers refuse with the same sentence: {dupes}"
