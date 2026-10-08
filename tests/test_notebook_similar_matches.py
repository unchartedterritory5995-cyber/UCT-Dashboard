"""Wave 13 lane 13J -- find more like this (`similar_matches.py`, `/api/j2/similar-names/*`).

  * THE MATHS: the distance and the score pinned on a fixture fingerprint pair, field by field,
    with the arithmetic beside it; the pattern term; the coverage floor; the reasons ARE the
    field deltas.
  * THE CONSTANTS: one block, every value pinned; the compared fields are exactly the
    fingerprint fields the nightly row holds (`tech_fingerprint._ROW_COLUMNS`).
  * THE NIGHTLY JOB: bounded (templates a member, members a run, a time budget, a shortlist of
    pattern reads), idempotent, inert while the flag is off, member-scoped, and it drops the rows
    of a chart that is no longer tagged.
  * ⛔ THE REQUEST PATH NEVER SCANS THE UNIVERSE: the screener store, the universe loader, the
    ranker, the fingerprint computation and the pattern store are all armed to raise, and the
    route still answers from the stored rows.
  * ACCOUNT PURGE takes `j2_similar_matches`, and only that member's rows.
  * THE ROUTES: 404 while off (before the session), 402 for a free plan, another member's note 404.

No screener store, bars store, vendor or model is reachable: the universe is fixture rows and
every fingerprint comes from a stub.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile

import pytest

from api.services.journal_two import chart_blocks, notes, similar_matches as sm
from api.services.journal_two import tech_fingerprint as tfp
from api.services.journal_two.db import ensure_schema

TEMPLATE = {"adr_pct": 5.0, "pct_vs_sma20": 2.0, "pct_vs_sma50": 10.0, "pct_vs_sma200": 30.0,
            "ma_stack": "full-bull", "ema_stack_intact": True, "rs_rank": 92, "rs_line_trend": "up",
            "pullback_depth_pct": 12.0, "vol_nweek_low": 15, "close_cv_pct": 1.5, "pole_pct": 60.0,
            "pct_vs_sma10": 1.0, "base_length_bars": 30, "base_depth_pct": 12.5,
            "patterns": [{"setup": "vcp", "asof_date": "2026-09-30"}]}
CANDIDATE = {"adr_pct": 5.6, "pct_vs_sma20": 3.0, "pct_vs_sma50": 12.0, "pct_vs_sma200": 50.0,
             "ma_stack": "partial", "ema_stack_intact": True, "rs_rank": 94, "rs_line_trend": "up",
             "pullback_depth_pct": 11.0, "vol_nweek_low": 20, "close_cv_pct": 1.5, "pole_pct": 80.0}


# ── the constants ─────────────────────────────────────────────────────────────────────────────

def test_the_constants_block_is_pinned():
    assert dict(sm.RULES) == {
        "adr_pct": (1.0, 3.0), "pct_vs_sma20": (1.0, 8.0), "pct_vs_sma50": (1.5, 15.0),
        "pct_vs_sma200": (0.5, 40.0), "ma_stack": (1.0, None), "ema_stack_intact": (0.5, None),
        "rs_rank": (2.0, 25.0), "rs_line_trend": (0.5, None), "pullback_depth_pct": (1.5, 10.0),
        "vol_nweek_low": (0.5, 10.0), "close_cv_pct": (1.0, 3.0), "pole_pct": (1.0, 50.0)}
    assert (sm.PATTERN_WEIGHT, sm.MIN_COVERAGE, sm.MIN_TEMPLATE_FIELDS, sm.SHORTLIST,
            sm.MATCHES_PER_TEMPLATE, sm.MAX_TEMPLATES, sm.MEMBER_CAP, sm.UNIVERSE_CAP,
            sm.RUN_BUDGET_S, sm.RETAIN_DAYS, sm.RUN_AT_ET) == (2.0, 0.6, 4, 50, 10, 25, 300, 8000,
                                                            600.0, 7, (5, 45))


def test_the_compared_fields_are_exactly_the_fingerprint_fields_the_nightly_row_holds():
    """Derived, not restated: a field the nightly row does not hold would force a per-name
    fingerprint computation, which the nightly job must never do."""
    assert set(sm.RULES) == set(tfp._ROW_COLUMNS)
    assert set(sm.RULES) <= set(tfp.FIELDS) and set(sm.LABELS) == set(sm.RULES)


# ── the maths ─────────────────────────────────────────────────────────────────────────────────

def test_the_fingerprint_distance_on_a_fixture_pair():
    fd = sm.fingerprint_distance(TEMPLATE, CANDIDATE)
    # w x d per field:
    #   adr   1.0 x |5.6-5.0|/3 = 0.2        sma20 1.0 x 1/8 = 0.125      sma50 1.5 x 2/15 = 0.2
    #   sma200 0.5 x 20/40 = 0.25            ma_stack 1.0 x 1 = 1.0        ema 0.5 x 0 = 0
    #   rs    2.0 x 2/25 = 0.16              rs line 0.5 x 0 = 0           depth 1.5 x 1/10 = 0.15
    #   vol   0.5 x 5/10 = 0.25              cv 1.0 x 0 = 0                pole 1.0 x 20/50 = 0.4
    #   sum 2.735 over weight 12.0 -> 0.2279166...
    assert fd["weight"] == pytest.approx(12.0)
    assert fd["sum"] == pytest.approx(2.735)
    assert fd["distance"] == pytest.approx(2.735 / 12.0)
    assert fd["coverage"] == pytest.approx(1.0)


def test_the_pattern_term_and_the_score():
    fd = sm.fingerprint_distance(TEMPLATE, CANDIDATE)
    shared = sm.with_patterns(fd, {"vcp"}, {"value": [{"setup": "vcp"}, {"setup": "flat_base"}], "missing": None})
    # d_pattern = 1 - 1/1 = 0 -> (2.735 + 2.0 x 0) / (12 + 2) = 0.195357...; score round(80.46) = 80
    assert shared["distance"] == pytest.approx(2.735 / 14.0)
    assert shared["patterns"] == {"shared": ["vcp"], "templateOnly": [], "missing": None}
    none = sm.with_patterns(fd, {"vcp"}, {"value": [], "missing": None})
    # d_pattern = 1 -> (2.735 + 2.0) / 14 = 0.338214...
    assert none["distance"] == pytest.approx(4.735 / 14.0)
    unread = sm.with_patterns(fd, {"vcp"}, {"value": None, "missing": "patterns_unavailable"})
    assert unread["distance"] == pytest.approx(2.735 / 12.0)       # compared without it, and said so
    assert unread["patterns"]["missing"] == "patterns_unavailable"

    uni = {"as_of": "2026-10-01", "rows": [{"symbol": "AAA", "as_of": "2026-10-01", "is_etf": False,
                                            "values": CANDIDATE}]}
    m = sm.rank_matches(TEMPLATE, "NVDA", uni,
                        pattern_field=lambda a, s: {"value": [{"setup": "vcp"}], "missing": None})
    assert [(x["rank"], x["symbol"], x["score"], x["distance"]) for x in m] == [(1, "AAA", 80, 0.1954)]


def test_the_reasons_are_the_field_deltas():
    fd = sm.fingerprint_distance(TEMPLATE, CANDIDATE)
    by = {r["field"]: r for r in fd["reasons"]}
    assert set(by) == set(sm.RULES)
    for f, (_, scale) in sm.RULES.items():
        r = by[f]
        assert (r["template"], r["candidate"]) == (TEMPLATE[f], CANDIDATE[f])
        if scale is None:
            assert r["delta"] is None and r["same"] == (TEMPLATE[f] == CANDIDATE[f])
        else:
            assert r["delta"] == round(CANDIDATE[f] - TEMPLATE[f], 2)
            assert r["d"] == round(min(1.0, abs(CANDIDATE[f] - TEMPLATE[f]) / scale), 4)
    assert (by["rs_rank"]["label"], by["rs_rank"]["delta"]) == ("RS", 2)
    assert (by["pullback_depth_pct"]["label"], by["pullback_depth_pct"]["delta"]) == ("depth", -1.0)


def test_too_little_in_common_is_not_ranked_and_a_thin_template_gets_nothing():
    sparse = {"adr_pct": 5.0, "rs_rank": 90}            # 3.0 of the template's 12.0 weight
    assert sm.fingerprint_distance(TEMPLATE, sparse) is None
    thin = {"adr_pct": 5.0, "rs_rank": 90, "close_cv_pct": 1.0}
    uni = {"as_of": "2026-10-01", "rows": [{"symbol": "AAA", "as_of": "2026-10-01", "is_etf": False,
                                            "values": CANDIDATE}]}
    assert sm.rank_matches(thin, "NVDA", uni) == []


def _row(sym, shift=0.0, etf=False, asof="20261001"):
    return {"ticker": sym, "bars_asof": asof, "is_etf": 1 if etf else 0, "candle_score": 3,
            "adr_pct": 5.0 + shift, "pct_vs_sma20": 2.0, "pct_vs_sma50": 10.0, "pct_vs_sma200": 30.0,
            "ma_stack": "full-bull", "ema_stack_intact": 1, "rs_rank": 92, "rs_line_trend": "up",
            "pullback_depth_pct": 12.0, "vol_nweek_low": None, "close_cv_pct": 1.5, "pole_pct": 60.0}


def test_the_universe_reads_rows_through_the_fingerprints_own_row_projection():
    uni = sm.universe_from_rows([_row("BBB"), _row("AAA", asof="2026-09-30"), _row("OLD", asof="20260920")])
    assert uni["as_of"] == "2026-10-01" and [r["symbol"] for r in uni["rows"]] == ["AAA", "BBB"]
    v = uni["rows"][1]["values"]
    # tech_fingerprint._row_fields: a None vol_nweek_low with a candle score is "computed, no
    # dry-up" = 0; ema_stack_intact 1 is True. Same values the fingerprint itself would read.
    assert v["vol_nweek_low"] == 0 and v["ema_stack_intact"] is True
    assert v == tfp.summary_values({"fields": tfp._row_fields(_row("BBB"))})


def test_ranking_is_deterministic_excludes_itself_and_etfs_and_reads_patterns_only_for_the_shortlist(monkeypatch):
    monkeypatch.setattr(sm, "SHORTLIST", 3)
    monkeypatch.setattr(sm, "MATCHES_PER_TEMPLATE", 2)
    rows = [_row("NVDA"), _row("ETFX", etf=True)] + [_row(f"S{i:02d}", shift=0.1 * (i % 5)) for i in range(12)]
    uni = sm.universe_from_rows(rows)
    reads = []

    def pf(as_of, sym):
        reads.append(sym)
        return {"value": [], "missing": None}
    t = {**uni["rows"][0]["values"], "patterns": TEMPLATE["patterns"]}     # NVDA's own row + a VCP
    m = sm.rank_matches(t, "NVDA", uni, pattern_field=pf)
    syms = [x["symbol"] for x in m]
    assert "NVDA" not in syms and "ETFX" not in syms
    # S00, S05, S10 tie at shift 0 -> symbol order; only the 3 shortlisted names were read
    assert syms == ["S00", "S05"] and sorted(reads) == ["S00", "S05", "S10"]
    assert m == sm.rank_matches(t, "NVDA", uni, pattern_field=pf)          # deterministic


# ── the nightly job ───────────────────────────────────────────────────────────────────────────

def _fp(values):
    return {"v": 1, "symbol": "X", "as_of": "2026-09-30", "mode": "bars",
            "fields": {f: {"value": values.get(f), "source": "bars",
                           "missing": None if values.get(f) is not None else "not_enough_history"}
                       for f in tfp.FIELDS}}


def _chart(embed_id, symbol="NVDA", tag="VCP"):
    attrs = {"v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": 1790791200},
             "capturedAt": "2026-09-30T18:00:00Z", "embedId": embed_id, "mode": "snapshot", "annotations": []}
    if tag:
        attrs["ta"] = {"setupTag": tag}
    return {"type": "widgetEmbed", "attrs": attrs}


def _doc(*nodes):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}, *nodes]}


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(sm.FLAG, "1")


def _universe():
    return sm.universe_from_rows([_row(f"S{i:02d}", shift=0.2 * i) for i in range(15)])


def stub_compute(symbol, as_of):
    return _fp(TEMPLATE)


def _stored(c, uid="u1"):
    return [tuple(r) for r in c.execute(
        "SELECT note_id, embed_key, as_of, rank, symbol, score, distance, coverage, reasons_json,"
        " template_symbol, template_as_of FROM j2_similar_matches WHERE user_id = ?"
        " ORDER BY note_id, embed_key, rank", (uid,))]


def test_the_nightly_job_is_inert_while_off(conn, monkeypatch):
    monkeypatch.delenv(sm.FLAG, raising=False)
    assert sm.run_nightly(conn=conn, universe=_universe()) == {"ran": False, "reason": "flag_off"}


def test_the_nightly_job_writes_ten_matches_a_tagged_chart_and_is_idempotent(conn, on):
    n = notes.create_note("u1", {"title": "NVDA VCP", "bodyJson": _doc(_chart("e-1"), _chart("e-2", tag=None))},
                          conn=conn)
    pf = lambda a, s: {"value": [], "missing": None}      # noqa: E731
    r1 = sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf)
    first = _stored(conn)
    assert r1["ran"] and r1["members"] == 1 and r1["templates"] == 1 and r1["rows"] == 10
    assert len(first) == 10 and {(x[0], x[1]) for x in first} == {(n["id"], "e-1")}   # the untagged chart: none
    assert [x[4] for x in first[:3]] == ["S00", "S01", "S02"]                           # closest adr first
    r2 = sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf)
    assert _stored(conn) == first and r2["rows"] == 10                                 # idempotent


def test_an_untagged_chart_loses_its_rows_and_members_are_isolated(conn, on):
    pf = lambda a, s: {"value": [], "missing": None}      # noqa: E731
    n = notes.create_note("u1", {"title": "a", "bodyJson": _doc(_chart("e-1"))}, conn=conn)
    notes.create_note("u2", {"title": "b", "bodyJson": _doc(_chart("e-9", symbol="AMD"))}, conn=conn)
    sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf)
    assert len(_stored(conn, "u1")) == 10 and len(_stored(conn, "u2")) == 10
    notes.update_note("u1", n["id"], {"bodyJson": _doc(_chart("e-1", tag=None))}, conn=conn)
    sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf)
    assert _stored(conn, "u1") == [] and len(_stored(conn, "u2")) == 10


def test_the_job_is_bounded_templates_members_and_time(conn, on, monkeypatch):
    pf = lambda a, s: {"value": [], "missing": None}      # noqa: E731
    notes.create_note("u1", {"title": "many", "bodyJson": _doc(*[_chart(f"e{i}") for i in range(30)])}, conn=conn)
    chart_blocks.catch_up("u1", conn, compute=stub_compute, freeze_budget=50)    # all 30 frozen
    r = sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf)
    assert r["templates"] == sm.MAX_TEMPLATES == 25
    for uid in ("u2", "u3"):
        notes.create_note(uid, {"title": "x", "bodyJson": _doc(_chart("e-1"))}, conn=conn)
    capped = sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf, member_cap=2)
    assert capped["members"] == 2
    ticks = iter([0.0, 0.0, 1000.0, 1000.0, 1000.0, 1000.0])
    timed = sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf,
                           budget_s=10.0, clock=lambda: next(ticks))
    assert timed["members"] == 1 and timed["deferred"] == 2


def test_the_least_recently_matched_member_goes_first(conn, on):
    pf = lambda a, s: {"value": [], "missing": None}      # noqa: E731
    for uid in ("u1", "u2"):
        notes.create_note(uid, {"title": "x", "bodyJson": _doc(_chart("e-1"))}, conn=conn)
    sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf, member_cap=1)
    assert _stored(conn, "u1") and not _stored(conn, "u2")
    sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf, member_cap=1)
    assert _stored(conn, "u2")                            # the one never matched went next


def test_the_scheduler_hook_registers_one_weekday_job():
    seen = {}

    class S:
        def add_job(self, fn, **kw):
            seen.update(kw, fn=fn)

    def cron(**kw):
        return kw
    assert sm.install_scheduler_hook(S(), cron, "ET") is True
    assert seen["id"] == sm.JOB_ID and seen["max_instances"] == 1 and seen["coalesce"] is True
    assert seen["trigger"] == {"day_of_week": "mon-fri", "hour": 5, "minute": 45, "timezone": "ET"}
    assert seen["fn"] is sm.run_nightly_blocking


def test_account_purge_takes_the_matches_and_only_that_member(conn, on):
    from api.services.journal_two import account_purge
    pf = lambda a, s: {"value": [], "missing": None}      # noqa: E731
    for uid in ("u1", "u2"):
        notes.create_note(uid, {"title": "x", "bodyJson": _doc(_chart("e-1"))}, conn=conn)
    sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute, pattern_field=pf)
    report = account_purge.purge_user_rows("u1", conn)
    assert report["rows_deleted"]["j2_similar_matches"] == 10
    assert _stored(conn, "u1") == [] and len(_stored(conn, "u2")) == 10


# ── the routes ────────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI                                 # noqa: E402
from fastapi.testclient import TestClient                   # noqa: E402

from api.middleware import auth_middleware as authmw        # noqa: E402

PAID = {"plan": "pro"}
FREE = {"plan": "free"}


@pytest.fixture
def client(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = auth_db.get_connection()
    ensure_schema(c)
    c.close()
    from api.routers import notebook_setups_board
    app = FastAPI()
    app.include_router(notebook_setups_board.similar_router)
    tc = TestClient(app)
    tc.app_ = app
    yield tc
    app.dependency_overrides.clear()
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


def as_user(client, uid, plan=PAID):
    user = {"id": uid, "role": "member", **plan}
    client.app_.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _seed_member(uid="m1"):
    from api.services import auth_db
    c = auth_db.get_connection()
    c.row_factory = sqlite3.Row
    try:
        n = notes.create_note(uid, {"title": "NVDA VCP", "bodyJson": _doc(_chart("e-1"))}, conn=c)
        sm.run_nightly(conn=c, universe=_universe(), compute=stub_compute,
                       pattern_field=lambda a, s: {"value": [], "missing": None})
        return n
    finally:
        c.close()


def test_every_similar_route_is_404_while_off_even_signed_out(client, monkeypatch):
    monkeypatch.delenv(sm.FLAG, raising=False)
    for path in ("/templates", "/n/e-1"):
        assert client.get("/api/j2/similar-names" + path).status_code == 404


def test_a_free_plan_is_refused(client, monkeypatch):
    monkeypatch.setenv(sm.FLAG, "1")
    as_user(client, "m1", FREE)
    assert client.get("/api/j2/similar-names/templates").status_code == 402


def _arm_universe_tripwires(monkeypatch):
    """Every door to a universe scan raises. The request path must not need any of them."""
    from api.services.screener import snapshot_db

    def boom(*a, **k):
        raise AssertionError("a request reached the universe")
    monkeypatch.setattr(snapshot_db, "connect", boom)
    monkeypatch.setattr(snapshot_db, "get_rows", boom)
    monkeypatch.setattr(snapshot_db, "get_projected", boom)
    monkeypatch.setattr(sm, "load_universe", boom)
    monkeypatch.setattr(sm, "rank_matches", boom)
    monkeypatch.setattr(sm, "run_nightly", boom)
    monkeypatch.setattr(tfp, "compute", boom)
    monkeypatch.setattr(tfp, "_read_confirmed_patterns", boom)
    monkeypatch.setattr(tfp, "_read_bars", boom)
    monkeypatch.setattr(tfp, "_read_row", boom)


def test_the_request_path_only_reads_precomputed_rows_never_the_universe(client, monkeypatch):
    monkeypatch.setenv(sm.FLAG, "1")
    n = _seed_member()
    _arm_universe_tripwires(monkeypatch)
    as_user(client, "m1")
    r = client.get(f"/api/j2/similar-names/{n['id']}/e-1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ready" and len(body["matches"]) == 10
    assert body["template"]["symbol"] == "NVDA" and body["template"]["setupTag"] == "VCP"
    first = body["matches"][0]
    assert first["symbol"] == "S00" and {x["field"] for x in first["reasons"]["fields"]} == set(sm.RULES)
    t = client.get("/api/j2/similar-names/templates")
    assert t.status_code == 200 and t.json()["templates"][0]["matchCount"] == 10


def test_a_tagged_chart_with_no_run_yet_is_pending_and_another_members_note_is_404(client, monkeypatch):
    monkeypatch.setenv(sm.FLAG, "1")
    from api.services import auth_db
    c = auth_db.get_connection()
    try:
        n = notes.create_note("m1", {"title": "fresh", "bodyJson": _doc(_chart("e-1"))}, conn=c)
    finally:
        c.close()
    _arm_universe_tripwires(monkeypatch)
    as_user(client, "m1")
    r = client.get(f"/api/j2/similar-names/{n['id']}/e-1")
    assert r.status_code == 200 and r.json()["status"] == "pending" and r.json()["matches"] == []
    as_user(client, "m2")
    assert client.get(f"/api/j2/similar-names/{n['id']}/e-1").status_code == 404


# ── fin walk P9: an example chart is never matched, and the answer says so ─────────────────

def _mark_sample(c, note_id):
    from api.services.journal_two import sample_marker
    c.execute("UPDATE j2_notes SET import_source = ? WHERE id = ?", (sample_marker.SAMPLE_SOURCE, note_id))
    c.commit()


def test_the_nightly_job_never_matches_a_sample_chart(conn, on):
    n = notes.create_note("u1", {"title": "Example plan", "bodyJson": _doc(_chart("e-1"))}, conn=conn)
    _mark_sample(conn, n["id"])
    r = sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute,
                       pattern_field=lambda a, s: {"value": [], "missing": None})
    assert r["templates"] == 0 and r["rows"] == 0 and _stored(conn) == []


def test_an_example_chart_answers_example_never_pending(conn, on):
    """ "Pending" tells the member the chart is matched tonight. An example never is, so its
    answer has its own status and a sentence the client can show."""
    n = notes.create_note("u1", {"title": "Example plan", "bodyJson": _doc(_chart("e-1"))}, conn=conn)
    mine = notes.create_note("u1", {"title": "Mine", "bodyJson": _doc(_chart("e-9"))}, conn=conn)
    _mark_sample(conn, n["id"])
    out = sm.read_matches(conn, "u1", n["id"], "e-1")
    assert out["status"] == "example" and out["matches"] == []
    assert out["template"]["example"] is True
    assert out["neverMatched"] == {
        "reason": "sample_example",
        "sentence": "This chart is an example, so it is never matched. Tag a chart of your own to find names like it.",
    }
    own = sm.read_matches(conn, "u1", mine["id"], "e-9")
    assert own["status"] == "pending" and own["neverMatched"] is None and own["template"]["example"] is False


def test_matches_stored_for_a_chart_before_it_was_known_as_an_example_are_not_shown(conn, on):
    n = notes.create_note("u1", {"title": "Example plan", "bodyJson": _doc(_chart("e-1"))}, conn=conn)
    sm.run_nightly(conn=conn, universe=_universe(), compute=stub_compute,
                   pattern_field=lambda a, s: {"value": [], "missing": None})
    assert sm.read_matches(conn, "u1", n["id"], "e-1")["status"] == "ready"
    _mark_sample(conn, n["id"])
    out = sm.read_matches(conn, "u1", n["id"], "e-1")
    assert out["status"] == "example" and out["matches"] == [] and out["asOf"] is None
