"""TERM-060 (FB-I1-02) — a machine-checkable citation pointer per claim.

The wire format, the checker, and the first product caller (the Score
Attribution `total` on `GET /api/breadth-monitor/score-components/{date}`),
each against the REAL stores through their real readers on throwaway files —
the same fixture discipline as `tests/test_canonical_resolver.py`. Only Entity
Master is stubbed.

The acceptance criteria, by name:
  * pointer round-trip       — `test_a_pointer_round_trips_through_the_one_grammar`
  * a wrong number is caught — `test_the_checker_catches_a_wrong_number`
  * unresolvable never verified — `test_an_unresolvable_pointer_is_NEVER_verified`
  * the caller's output      — `test_the_caller_*` (and the rendered text in
    `app/src/pages/breadth/views/TheReadStrip.test.jsx`)
"""
from __future__ import annotations

import pytest

from api.services import breadth_monitor
from api.services.cache import cache
from api.services.canonical import claims, resolver
from api.services.entity_master import api as em
from api.services.screener import snapshot_db

TICKER = "AAPL"
_SCORED = {  # enough weight for `_score_breakdown` to answer a total
    "pct_above_50sma": 61.25, "ratio_5day": 1.3, "magna_up": 70, "magna_down": 30,
    "hi_ratio": 4.0, "cboe_putcall": 0.8, "aaii_spread": -10, "vix": 18,
    "stage2_count": 1200, "universe_count": 5000, "adv_decline": 900,
}
_BREADTH = {
    "2026-09-23": dict(_SCORED, pct_above_50sma=55.5),
    "2026-09-24": dict(_SCORED, pct_above_50sma=58.0),
    "2026-09-25": dict(_SCORED),
}
_SCREENER_ROW = {"ticker": TICKER, "rs_rank": 88.0, "above_50sma": 1,
                 "bars_asof": "20260925", "snapshot_date": "2026-09-26"}


def _resolved_entity(symbol, as_of=None, **_):
    return em.ResolveResult(status="resolved", entity=em.Entity(
        entity_id=f"ent_{symbol.lower()}", entity_type="equity",
        lifecycle_state="active", lifecycle_since=None))


@pytest.fixture
def stores(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_MONITOR_DB", str(tmp_path / "breadth.db"))
    breadth_monitor.init_db()
    for d, m in _BREADTH.items():
        assert breadth_monitor.store_snapshot(d, dict(m))
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([dict(_SCREENER_ROW)])
    monkeypatch.setattr(em, "resolve", _resolved_entity)
    cache.delete_prefix("breadth_history_")
    yield tmp_path
    cache.delete_prefix("breadth_history_")


PCT50 = "breadth_snapshot_numeric.pct_above_50sma"


# ─────────────────────────────────────────────────────────────────────────────
# the wire format
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("parts", [
    {"metric": PCT50, "entity": None, "tf": "D", "as_of": "2026-09-25"},
    {"metric": "rs_rank", "entity": TICKER, "tf": None, "as_of": None},
    {"metric": "ohlcv.c", "entity": TICKER, "tf": "D", "as_of": "2026-09-25T10:00:00"},
])
def test_a_pointer_round_trips_through_the_one_grammar(parts):
    ptr = resolver.format_address(parts["metric"], entity=parts["entity"], tf=parts["tf"],
                                  as_of=parts["as_of"])
    assert resolver.parse_address(ptr) == dict(parts, provider=None)
    # …and it is the grammar `resolve` itself matches, not a lookalike.
    assert resolver._ADDRESS_RE.match(ptr)


def test_a_pointer_that_would_not_round_trip_is_refused_not_emitted():
    with pytest.raises(ValueError):
        resolver.format_address("not a metric")
    with pytest.raises(ValueError):
        resolver.format_address(PCT50, as_of="2026-09-25&provider=x")


def test_parse_refuses_what_resolve_refuses():
    for bad in ("", "uct://", "http://x", "uct://m?as_of=1&as_of=2", "uct://m?nope=1", None, 7):
        assert resolver.parse_address(bad) is None, bad


def test_make_claim_is_the_documented_wire_shape():
    c = claims.make_claim(PCT50, 61.3, tf="D", as_of="2026-09-25")
    assert c == {"v": 1, "pointer": f"uct://{PCT50}/D?as_of=2026-09-25",
                 "stated": 61.3, "decimals": 1}


@pytest.mark.parametrize("stated,dec", [(72.4, 1), (80.0, 0), (3, 0), (61.25, 2),
                                         (0.001, 3), (True, None), (float("nan"), None), ("7", None)])
def test_stated_decimals_is_the_precision_the_number_states(stated, dec):
    assert claims.stated_decimals(stated) == dec


# ─────────────────────────────────────────────────────────────────────────────
# the checker
# ─────────────────────────────────────────────────────────────────────────────

def test_a_right_number_is_verified_at_its_stated_precision(stores):
    for stated, dec in ((61.25, 2), (61.3, 1), (61.2, 1), (61, 0)):
        chk = claims.check_claim(claims.make_claim(PCT50, stated, decimals=dec, tf="D",
                                                   as_of="2026-09-25"))
        assert (chk["verdict"], chk["reason"], chk["status"]) == (
            claims.VERIFIED, claims.REASON_MATCH, resolver.RESOLVED), (stated, chk)
        assert chk["resolved_value"] == 61.25
        assert chk["resolved_as_of"] == "2026-09-25"


def test_the_checker_catches_a_wrong_number(stores):
    """⛔ THE CHECKER'S WHOLE JOB. Every one of these reads the stored 61.25 and
    must say the claim disagrees — including a claim one rounding step off."""
    for stated, dec in ((62.0, 1), (61.4, 1), (61.3, 2), (60, 0), (0, 0), (-61.25, 2)):
        chk = claims.check_claim(claims.make_claim(PCT50, stated, decimals=dec, tf="D",
                                                   as_of="2026-09-25"))
        assert (chk["verdict"], chk["reason"]) == (claims.MISMATCH, claims.REASON_VALUE_DIFFERS), (
            stated, dec, chk)
        assert chk["status"] == resolver.RESOLVED and chk["resolved_value"] == 61.25


def test_a_value_from_another_session_is_not_the_value_cited(stores):
    """The store has no 2026-09-26 row; `resolve` answers the newest at or
    before it (2026-09-25). The number matches, the SESSION does not."""
    chk = claims.check_claim(claims.make_claim(PCT50, 61.25, tf="D", as_of="2026-09-26"))
    assert (chk["verdict"], chk["reason"]) == (claims.MISMATCH, claims.REASON_AS_OF_DIFFERS)
    assert chk["resolved_as_of"] == "2026-09-25"


def _claim(pointer, stated=61.25, decimals=2):
    return {"v": 1, "pointer": pointer, "stated": stated, "decimals": decimals}


@pytest.mark.parametrize("pointer,status", [
    ("uct://no_such_metric/D", resolver.UNKNOWN_METRIC),
    ("not an address", resolver.UNKNOWN_METRIC),
    (f"uct://{PCT50}/5?as_of=2026-09-25", resolver.UNKNOWN_METRIC),        # intraday on a daily store
    (f"uct://{PCT50}@{TICKER}/D", resolver.UNRESOLVED_ENTITY),            # entity on a market-wide store
    (f"uct://{PCT50}/D?as_of=2020-01-02", resolver.EMPTY),                # before the series starts
    (f"uct://{PCT50}/D?provider=massive", resolver.NOT_COMPUTABLE),
])
def test_an_unresolvable_pointer_is_NEVER_verified(stores, pointer, status):
    """⛔ Whatever number the claim states — including the stored one — a
    pointer that does not resolve is `unverified`, and `status` is always one
    of the resolver's five, verbatim."""
    chk = claims.check_claim(_claim(pointer))
    assert chk["status"] == status, chk
    assert chk["status"] in resolver.STATUSES
    assert chk["verdict"] == claims.UNVERIFIED
    # a pointer the grammar cannot parse is a malformed CLAIM before it is a miss
    assert chk["reason"] == (claims.REASON_MALFORMED if resolver.parse_address(pointer) is None
                             else claims.REASON_NOT_RESOLVED)
    assert chk["resolved_value"] is None


@pytest.mark.parametrize("claim", [
    None, "a string", [], {"pointer": f"uct://{PCT50}/D?as_of=2026-09-25"},
    _claim(f"uct://{PCT50}/D?as_of=2026-09-25", stated=True),
    _claim(f"uct://{PCT50}/D?as_of=2026-09-25", stated="61.25"),
    _claim(f"uct://{PCT50}/D?as_of=2026-09-25", decimals=-1),
    _claim(f"uct://{PCT50}/D?as_of=2026-09-25", decimals=99),
    _claim(f"uct://{PCT50}/D?as_of=2026-09-25", decimals=True),
    _claim(f"uct://{PCT50}/D?as_of=2026-09-25", stated=61.25, decimals=1),  # more precision than stated
    dict(_claim(f"uct://{PCT50}/D?as_of=2026-09-25"), v=2),
])
def test_a_malformed_claim_is_never_verified_even_carrying_the_right_number(stores, claim):
    chk = claims.check_claim(claim)
    assert chk["verdict"] == claims.UNVERIFIED, chk
    assert chk["status"] in resolver.STATUSES


def test_a_non_numeric_stored_value_cannot_verify_a_number(stores):
    chk = claims.check_claim(_claim(f"uct://above_50sma@{TICKER}", stated=1, decimals=0))
    assert chk["status"] == resolver.RESOLVED
    assert (chk["verdict"], chk["reason"]) == (claims.UNVERIFIED, claims.REASON_NOT_A_NUMBER)


def test_a_store_that_raises_is_unverified_and_the_checker_does_not_raise(stores, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("disk gone")
    monkeypatch.setattr(breadth_monitor, "get_history", boom)
    chk = claims.check_claim(claims.make_claim(PCT50, 61.25, tf="D", as_of="2026-09-25"))
    assert (chk["verdict"], chk["status"]) == (claims.UNVERIFIED, resolver.NOT_COMPUTABLE)


def test_verified_has_exactly_one_road():
    """⛔ Structural: the only assignment of VERIFIED in the checker is the one
    after every guard. A second road is a second definition of "verified"."""
    import ast
    import inspect
    src = inspect.getsource(claims.check_claim)
    hits = [n for n in ast.walk(ast.parse(src))
            if isinstance(n, ast.keyword) and n.arg == "verdict"
            and isinstance(n.value, ast.Name) and n.value.id == "VERIFIED"]
    assert len(hits) == 1


def test_the_module_writes_nothing_and_reaches_no_vendor():
    import ast
    import pathlib
    tree = ast.parse(pathlib.Path(claims.__file__).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            node.value.value = ""
    code = ast.unparse(tree)
    assert "def check_claim" in code, "the stripper removed real code — control failed"
    for needle in ("INSERT", "UPDATE ", "DELETE", "open(", "write_text", "httpx",
                   "requests", "urllib", "anthropic"):
        assert needle not in code, needle


# ─────────────────────────────────────────────────────────────────────────────
# the first product caller — GET /api/breadth-monitor/score-components/{date}
# ─────────────────────────────────────────────────────────────────────────────

def _route(date, **kw):
    from api.routers import breadth_monitor as router
    return router.get_breadth_score_components(date, days=90, _user={}, **kw)


def test_the_caller_ships_the_total_with_a_VERIFIED_pointer(stores):
    out = _route("2026-09-25")
    assert out["ok"] is True and out["total"] is not None
    claim = out["claims"]["total"]
    assert claim["pointer"] == (
        "uct://breadth_snapshot_numeric.breadth_score/D?as_of=2026-09-25")
    assert claim["stated"] == out["total"]
    assert claim["check"]["verdict"] == claims.VERIFIED, claim
    assert claim["check"]["status"] == resolver.RESOLVED
    assert claim["check"]["resolved_as_of"] == "2026-09-25"
    # additive: every pre-existing key is still there, unchanged in kind
    assert {"ok", "date", "total", "min_weight_met", "components", "prev"} <= set(out)


def test_the_caller_flags_a_total_that_disagrees_with_the_store(stores, monkeypatch):
    """The payload's total is kept (the Read flags it, it does not vanish) and
    its claim says, in the resolver's own terms, that it does not match."""
    from api.routers import breadth_monitor as router
    real = router.svc.score_components

    def off_by_five(date, days=90):
        body = real(date, days=days)
        return dict(body, total=round(body["total"] + 5, 1))
    monkeypatch.setattr(router.svc, "score_components", off_by_five)
    out = _route("2026-09-25")
    chk = out["claims"]["total"]["check"]
    assert (chk["verdict"], chk["reason"]) == (claims.MISMATCH, claims.REASON_VALUE_DIFFERS)
    assert out["claims"]["total"]["stated"] == out["total"]


def test_the_caller_attaches_nothing_when_there_is_no_number_to_cite(stores):
    out = _route("2026-09-30")           # not stored → ok:false
    assert out["ok"] is False and "claims" not in out


def test_the_caller_never_fails_a_request_over_a_citation(stores, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("checker exploded")
    monkeypatch.setattr(claims, "checked_claim", boom)
    out = _route("2026-09-25")
    assert out["ok"] is True and out["total"] is not None
    assert "claims" not in out           # absent ⇒ the Read shows "citation unavailable"
