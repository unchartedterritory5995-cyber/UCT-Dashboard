"""Wave 13 lane 13I-2 -- the visual playbook (`visual_playbook.py`) and its routes
(`api/routers/notebook_visual_playbook.py`).

  * THE GRID reads 13I-1's chart-block index: only blocks carrying a setup tag, each with its
    archived image and its frozen fingerprint values (`tech_fingerprint.summary_values`).
  * THE OUTCOME joins through 13A's frozen plan links on the STABLE `trade_ref`: a broker
    resync that deletes and reinserts the trade under a new `j2_trades.id` keeps the outcome.
  * FILTERS: setup, outcome, timeframe and fingerprint ranges; a block with no number for a
    filtered field is excluded and COUNTED, never passed.
  * SLICE STATS are the per-setup authority's own arithmetic (`playbook_stats`), with the R3
    bands at n = 9 / 10 / 24 / 25 and a range only in the thin band.
  * THE ROUTES: 404 while the flag is off (before the session), 402 for a free plan on the
    grid, another member's trade is the one 404, and nothing here writes a note.

No bars store, vendor or model is reachable: every fingerprint here rides the note (`ta`).
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile

import pytest

from api.services.journal_two import chart_blocks, notes, playbook_stats, plan_grading
from api.services.journal_two import tech_fingerprint as tfp
from api.services.journal_two import visual_playbook as vp
from api.services.journal_two.db import ensure_schema

TO_0930 = 1759255200 + 365 * 86400      # 2026-09-30 14:00 ET


def _fp(**values):
    fields = {f: {"value": None, "source": "screener_row", "missing": "not_in_screener_row"}
              for f in tfp.FIELDS}
    for k, v in values.items():
        fields[k] = {"value": v, "source": "screener_row", "missing": None}
    return {"v": 1, "symbol": "X", "requested_as_of": "2026-09-30", "as_of": "2026-09-30",
            "mode": "nightly", "fields": fields}


def _chart(embed_id, symbol, tag=None, fp=None, tf="D", image=True):
    attrs = {"v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": tf, "to": TO_0930},
             "capturedAt": "2026-09-30T18:00:00Z", "embedId": embed_id, "mode": "snapshot",
             "annotations": []}
    if image:
        attrs["fallback"] = {"url": f"/img/{embed_id}.png", "w": 800, "h": 400}
    ta = {}
    if tag:
        ta["setupTag"] = tag
    if fp:
        ta["fingerprint"] = fp
    if ta:
        attrs["ta"] = ta
    return {"type": "widgetEmbed", "attrs": attrs}


def _doc(*nodes):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "plan"}]},
                                       *nodes]}


def _trade(c, uid, tid, symbol, result, r, pnl, exit_date, *, ext=None, setup=None):
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, setup, pnl_dollar, pnl_percent, r_multiple, hold_days,"
        " result, context_at_entry, created_at, source, external_id)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, uid, "p-" + tid, symbol, "Long", 100, 100.0, "2026-09-30T14:00:00Z", 100.0 + pnl / 100,
         exit_date, 96.0, setup, pnl, pnl / 10000, r, 3, result, "{}", "2026-09-30T00:00:00Z",
         "broker" if ext else "manual", ext))
    c.commit()


def _link(c, uid, trade_ref, note_id, symbol, plan=None):
    c.execute(
        "INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind, match_tier, note_id,"
        " plan_json, flags_json, matched_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (uid, trade_ref, symbol, "note", "window", note_id,
         json.dumps(plan or {"entry": 100.0, "stop": 96.0, "target": 112.0, "shares": 100}), "[]",
         "2026-09-30T00:00:00Z"))
    c.commit()


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    chart_blocks.ensure_schema(c)
    yield c
    c.close()


def _note(c, uid, title, *nodes):
    return notes.create_note(uid, {"title": title, "bodyJson": _doc(*nodes)}, conn=c)


def _seed(c):
    """Three tagged charts and one untagged: VCP (win, 2R, RS 95), VCP (loss, -1R, RS 80),
    Bull Flag (no trade, RS missing); an untagged chart never shows."""
    a = _note(c, "u1", "NVDA plan", _chart("a", "NVDA", "VCP", _fp(rs_rank=95, base_depth_pct=12.0)))
    b = _note(c, "u1", "AMD plan", _chart("b", "AMD", "VCP", _fp(rs_rank=80, base_depth_pct=22.0)))
    f = _note(c, "u1", "TSLA plan", _chart("f", "TSLA", "Bull Flag", _fp(base_depth_pct=9.0), tf="W"))
    _note(c, "u1", "untagged", _chart("u", "AAPL", None, _fp(rs_rank=99)))
    _trade(c, "u1", "t-win", "NVDA", "Win", 2.0, 800.0, "2026-10-01T15:00:00Z", ext="X-NVDA-1")
    _trade(c, "u1", "t-loss", "AMD", "Loss", -1.0, -400.0, "2026-10-01T16:00:00Z")
    _link(c, "u1", "ext:X-NVDA-1", a["id"], "NVDA")
    _link(c, "u1", "id:t-loss", b["id"], "AMD")
    return a, b, f


# ── the grid ──────────────────────────────────────────────────────────────────

def test_only_tagged_blocks_show_with_image_fingerprint_and_outcome(conn):
    a, b, f = _seed(conn)
    out = vp.cards("u1", conn)
    by = {c["symbol"]: c for c in out["cards"]}
    assert set(by) == {"NVDA", "AMD", "TSLA"}                       # the untagged AAPL is not a card
    assert by["NVDA"]["image"]["url"] == "/img/a.png"
    assert by["NVDA"]["values"]["rs_rank"] == 95 and by["NVDA"]["fingerprintSource"] == "note"
    assert by["NVDA"]["outcome"] == "win" and by["NVDA"]["trades"][0]["rMultiple"] == 2.0
    assert by["AMD"]["outcome"] == "loss"
    assert by["TSLA"]["outcome"] == "none" and by["TSLA"]["trades"] == []
    assert out["facets"]["setups"] == {"VCP": 2, "Bull Flag": 1}
    assert out["regime"]["available"] is False and "13E" in out["regime"]["reason"]


def test_the_outcome_joins_on_the_stable_trade_ref_and_survives_a_broker_resync(conn):
    """A broker resync purges and reinserts every imported trade under a FRESH id. The link is
    keyed on `ext:<external_id>`, so the card keeps its outcome -- and lands on the NEW row."""
    _seed(conn)
    conn.execute("DELETE FROM j2_trades WHERE id = 't-win'")
    _trade(conn, "u1", "t-win-reissued", "NVDA", "Win", 2.0, 800.0, "2026-10-01T15:00:00Z", ext="X-NVDA-1")
    by = {c["symbol"]: c for c in vp.cards("u1", conn)["cards"]}
    assert by["NVDA"]["outcome"] == "win"
    assert by["NVDA"]["trades"][0]["tradeId"] == "t-win-reissued"


def test_a_link_whose_trade_is_gone_has_no_outcome_rather_than_a_wrong_one(conn):
    _seed(conn)
    conn.execute("DELETE FROM j2_trades WHERE id = 't-loss'")
    conn.commit()
    by = {c["symbol"]: c for c in vp.cards("u1", conn)["cards"]}
    assert by["AMD"]["outcome"] == "none" and by["AMD"]["trades"] == []


def test_filters_setup_outcome_timeframe(conn):
    _seed(conn)
    assert {c["symbol"] for c in vp.cards("u1", conn, setups=["VCP"])["cards"]} == {"NVDA", "AMD"}
    assert {c["symbol"] for c in vp.cards("u1", conn, outcome="win")["cards"]} == {"NVDA"}
    assert {c["symbol"] for c in vp.cards("u1", conn, outcome="none")["cards"]} == {"TSLA"}
    assert {c["symbol"] for c in vp.cards("u1", conn, timeframe="W")["cards"]} == {"TSLA"}
    assert vp.cards("u1", conn, setups=["Cup & Handle"])["cards"] == []


def test_a_range_filter_and_missing_values_are_excluded_and_counted(conn):
    _seed(conn)
    out = vp.cards("u1", conn, ranges=["rs_rank:90:"])
    assert [c["symbol"] for c in out["cards"]] == ["NVDA"]
    assert out["excludedMissing"] == {"rs_rank": 1}                # TSLA has no RS rank: counted
    both = vp.cards("u1", conn, setups=["VCP"], ranges=["rs_rank:90:", "base_depth_pct::15"])
    assert [c["symbol"] for c in both["cards"]] == ["NVDA"]
    assert [c["symbol"] for c in vp.cards("u1", conn, ranges=["base_depth_pct::10"])["cards"]] == ["TSLA"]


@pytest.mark.parametrize("bad", ["rs_rank", "nope:1:2", "rs_rank::", "rs_rank:x:", "rs_rank:9:1",
                                 "ma_stack:1:", "rs_rank:inf:"])
def test_a_bad_range_is_refused(conn, bad):
    with pytest.raises(vp.PlaybookRequestError):
        vp.cards("u1", conn, ranges=[bad])


def test_every_fingerprint_field_is_declared_range_or_not():
    assert set(vp.RANGE_FIELDS) | set(vp.NON_RANGE_FIELDS) == set(tfp.FIELDS)
    assert not set(vp.RANGE_FIELDS) & set(vp.NON_RANGE_FIELDS)


# ── slice stats: the authority's arithmetic and the R3 bands ──────────────────

def test_slice_stats_equal_the_per_setup_authority(conn):
    """A slice that is exactly one setup's trades reads the SAME numbers as that setup's
    Playbook record from `playbook_stats.get_playbook_stats` (the authority)."""
    notes_ = []
    for i in range(12):
        n = _note(conn, "u1", f"plan {i}", _chart(f"e{i}", "NVDA", "VCP", _fp(rs_rank=90 + i % 5)))
        res = ["Win", "Loss", "BE"][i % 3]
        r = [2.5, -1.0, 0.0][i % 3]
        _trade(conn, "u1", f"t{i}", "NVDA", res, r, r * 300, f"2026-10-{i + 1:02d}T15:00:00Z", setup="VCP")
        _link(conn, "u1", f"id:t{i}", n["id"], "NVDA")
        notes_.append(n)
    stats = vp.cards("u1", conn, setups=["VCP"])["stats"]
    auth = [r for r in playbook_stats.get_playbook_stats("u1", conn=conn) if r["setup"] == "VCP"][0]
    assert stats["trades"] == auth["tradeCount"] == 12
    assert stats["winRate"] == auth["winRate"]
    assert stats["avgR"] == auth["avgR"]
    assert stats["totalPnlDollar"] == auth["totalPnlDollar"]
    assert (stats["wins"], stats["losses"], stats["breakeven"]) == (auth["winCount"], auth["lossCount"],
                                                                    auth["beCount"])


def test_one_trade_linked_from_two_charts_counts_once(conn):
    n = _note(conn, "u1", "two charts", _chart("x1", "NVDA", "VCP"), _chart("x2", "NVDA", "VCP"))
    _trade(conn, "u1", "t1", "NVDA", "Win", 1.0, 100.0, "2026-10-01T15:00:00Z")
    _link(conn, "u1", "id:t1", n["id"], "NVDA")
    stats = vp.cards("u1", conn)["stats"]
    assert stats["charts"] == 2 and stats["trades"] == 1


@pytest.mark.parametrize("n,band,wording", [(9, "too_few", "too few to judge"), (10, "thin", "thin sample"),
                                            (24, "thin", "thin sample"), (25, "normal", None)])
def test_r3_bands_at_the_boundaries(conn, n, band, wording):
    for i in range(n):
        note = _note(conn, "u1", f"p{i}", _chart(f"e{i}", "AMD", "VCP"))
        res = "Win" if i % 2 else "Loss"
        _trade(conn, "u1", f"t{i}", "AMD", res, 1.5 if i % 2 else -1.0, 10.0, f"2026-10-{(i % 28) + 1:02d}T15:00:00Z")
        _link(conn, "u1", f"id:t{i}", note["id"], "AMD")
    s = vp.cards("u1", conn)["stats"]
    assert (s["n"], s["band"], s["wording"]) == (n, band, wording)
    # A range only in the thin band (R3); the too-few stat still rides along for its reveal.
    assert (s["winRateRange"] is not None) == (band == "thin")
    assert (s["avgRRange"] is not None) == (band == "thin")
    assert s["winRate"] is not None
    if band == "thin":
        lo, hi = s["winRateRange"]
        assert lo <= s["winRate"] <= hi
        assert s["winRateRange"] == list(plan_grading.wilson(s["wins"], s["wins"] + s["losses"]))


def test_an_empty_slice_has_no_rate_and_says_too_few(conn):
    _seed(conn)
    s = vp.cards("u1", conn, setups=["Cup & Handle"])["stats"]
    assert s["trades"] == 0 and s["winRate"] is None and s["band"] == "too_few"


# ── nothing here writes a note ────────────────────────────────────────────────

def test_reading_the_grid_and_before_after_never_writes_a_note(conn):
    _seed(conn)
    before = [tuple(r) for r in conn.execute("SELECT id, updated_at, body_json FROM j2_notes ORDER BY id")]
    links_before = [tuple(r) for r in conn.execute("SELECT * FROM j2_trade_plan_links ORDER BY trade_ref")]
    vp.cards("u1", conn, setups=["VCP"], ranges=["rs_rank:1:"])
    vp.before_after("u1", "t-loss", conn)
    assert [tuple(r) for r in conn.execute("SELECT id, updated_at, body_json FROM j2_notes ORDER BY id")] == before
    assert [tuple(r) for r in conn.execute("SELECT * FROM j2_trade_plan_links ORDER BY trade_ref")] == links_before


# ── before and after ──────────────────────────────────────────────────────────

def test_before_after_carries_fills_the_frozen_plan_and_the_plan_chart(conn):
    a, _, _ = _seed(conn)
    out = vp.before_after("u1", "t-win", conn)
    assert out["trade"]["entryPrice"] == 100.0 and out["trade"]["entryDay"] == "2026-09-30"
    assert out["trade"]["exitDay"] == "2026-10-01"
    assert out["planStatus"] == "linked"
    assert (out["plan"]["entry"], out["plan"]["stop"], out["plan"]["target"]) == (100.0, 96.0, 112.0)
    assert out["plan"]["noteId"] == a["id"] and out["plan"]["noteTitle"] == "NVDA plan"
    assert out["planChart"]["setupTag"] == "VCP" and out["planChart"]["image"]["url"] == "/img/a.png"
    assert out["planChart"]["values"]["rs_rank"] == 95


def test_before_after_with_no_plan_freezes_nothing(conn):
    _trade(conn, "u1", "lonely", "MSFT", "Win", None, 50.0, "2026-10-01T15:00:00Z")
    out = vp.before_after("u1", "lonely", conn)
    assert out["planStatus"] == "none" and out["plan"] is None and out["planChart"] is None
    assert conn.execute("SELECT COUNT(*) FROM j2_trade_plan_links").fetchone()[0] == 0
    assert vp.before_after("u2", "lonely", conn) is None             # another member's trade


# ── the routes ────────────────────────────────────────────────────────────────

from fastapi import FastAPI                                 # noqa: E402
from fastapi.testclient import TestClient                   # noqa: E402

from api.middleware import auth_middleware as authmw        # noqa: E402

PAID = {"plan": "pro"}
FREE = {"plan": "free"}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = auth_db.get_connection()
    ensure_schema(c)
    for uid in ("m1", "m2"):
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                  (uid, f"{uid}@example.com", "x", uid, "member"))
    c.commit()
    c.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def client(db_path, monkeypatch):
    from api.routers import notebook_visual_playbook
    def _no_compute(*a, **k):
        raise AssertionError("no fingerprint may be computed here: every block carries its own")
    monkeypatch.setattr(tfp, "compute", _no_compute)
    app = FastAPI()
    app.include_router(notebook_visual_playbook.router)
    c = TestClient(app)
    c.app_ = app
    yield c
    app.dependency_overrides.clear()


def as_user(client, uid, plan=PAID):
    user = {"id": uid, "role": "member", **plan}
    client.app_.dependency_overrides[authmw.get_current_user] = lambda: dict(user)
    client.app_.dependency_overrides[authmw.get_current_user_with_plan] = lambda: dict(user)


def _auth_conn():
    from api.services import auth_db
    c = auth_db.get_connection()
    c.row_factory = sqlite3.Row
    return c


BASE = "/api/j2/notebook-visual-playbook"


def test_every_route_is_404_while_the_flag_is_off_even_signed_out(client, monkeypatch):
    monkeypatch.delenv(vp.FLAG, raising=False)
    for path in ("/cards", "/cards?setup=VCP&range=rs_rank:90:", "/trades/t1/before-after"):
        assert client.get(BASE + path).status_code == 404, path


def test_the_flag_is_read_per_request(client, monkeypatch):
    as_user(client, "m1")
    monkeypatch.setenv(vp.FLAG, "1")
    assert client.get(BASE + "/cards").status_code == 200
    monkeypatch.setenv(vp.FLAG, "0")
    assert client.get(BASE + "/cards").status_code == 404


def test_the_grid_and_before_after_both_need_a_paid_plan(client, monkeypatch):
    """Before/after was session-only; owner ruling 2026-10-02 (security review I-7) closed it."""
    monkeypatch.setenv(vp.FLAG, "1")
    as_user(client, "m1", FREE)
    assert client.get(BASE + "/cards").status_code == 402
    assert client.get(BASE + "/trades/nope/before-after").status_code == 402
    as_user(client, "m1", PAID)
    assert client.get(BASE + "/trades/nope/before-after").status_code == 404


def test_the_routes_serve_filters_and_scope_to_the_member(client, monkeypatch):
    monkeypatch.setenv(vp.FLAG, "1")
    c = _auth_conn()
    try:
        _seed_route(c)
    finally:
        c.close()
    as_user(client, "m1")
    r = client.get(BASE + "/cards?setup=VCP&range=rs_rank:90:")
    assert r.status_code == 200 and [x["symbol"] for x in r.json()["cards"]] == ["NVDA"]
    assert client.get(BASE + "/cards?range=bogus:1:").status_code == 422
    assert client.get(BASE + "/cards?outcome=maybe").status_code == 422
    ba = client.get(BASE + "/trades/t-win/before-after")
    assert ba.status_code == 200 and ba.json()["planStatus"] == "linked"

    as_user(client, "m2")
    assert client.get(BASE + "/cards").json()["count"] == 0
    assert client.get(BASE + "/trades/t-win/before-after").status_code == 404


def _seed_route(c):
    a = _note(c, "m1", "NVDA plan", _chart("a", "NVDA", "VCP", _fp(rs_rank=95)))
    _note(c, "m1", "AMD plan", _chart("b", "AMD", "VCP", _fp(rs_rank=80)))
    _trade(c, "m1", "t-win", "NVDA", "Win", 2.0, 800.0, "2026-10-01T15:00:00Z")
    _link(c, "m1", "id:t-win", a["id"], "NVDA")
