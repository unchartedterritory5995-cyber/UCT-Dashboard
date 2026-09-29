"""The breadth authority seam: V1 legacy / frozen V2c2 / live V2 / provisional collector.

The frozen identity constants are monkeypatched onto a synthetic artifact so the REAL
verification path (size, sha256, row count, metric set, PIT-gap set) runs on every test.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sqlite3

import pytest

from api.services import breadth_authority as ba

M = ba.V2_METRICS
SESSIONS = ["2026-03-23", "2026-03-24", "2026-03-25", "2026-08-31", "2026-09-01",
            "2026-09-22", "2026-09-23", "2026-09-24"]


def _val(d, m):
    return float(hash((d, m)) % 1000) / 10.0


def _make_frozen(path, gaps=ba.PIT_GAPS_RULED, body=("2026-09-01", "pct_above_50sma"),
                 extra_source=None, uct_before_start=False):
    c = sqlite3.connect(path)
    c.executescript("""
        CREATE TABLE breadth_daily_ohlc (universe TEXT, date TEXT, metric TEXT, o REAL, h REAL,
            l REAL, c REAL, source TEXT, updated_at TEXT, PRIMARY KEY (universe, date, metric));
        CREATE TABLE pass_checkpoint (date TEXT PRIMARY KEY, status TEXT, universe_sizes TEXT,
            rows INTEGER, detail TEXT, at TEXT);""")
    for d in SESSIONS:
        c.execute("INSERT INTO pass_checkpoint(date, status) VALUES(?, 'done')", (d,))
        for u in ("uct", "us"):
            if u == "uct" and d in gaps:
                continue
            for m in M:
                v = _val(d, m)
                src = "intraday_recon_1m"
                o, h, l = v - 1, v + 2, v - 3
                if (d, m) == body and u == "uct":
                    src = "intraday_recon_1m_body"
                    o = h = l = v
                c.execute("INSERT INTO breadth_daily_ohlc VALUES(?,?,?,?,?,?,?,?,NULL)",
                          (u, d, m, o, h, l, v, extra_source or src))
    if uct_before_start:
        c.execute("INSERT INTO breadth_daily_ohlc VALUES('uct','2026-03-20','adv_decline',1,1,1,1,"
                  "'intraday_recon_1m',NULL)")
    c.commit()
    n = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
    c.close()
    return n


@pytest.fixture
def v2(tmp_path, monkeypatch):
    root = tmp_path / "bv2"
    monkeypatch.setenv("BREADTH_V2_DIR", str(root))
    monkeypatch.setenv("BREADTH_AUTHORITY", "v2")
    os.makedirs(root / "frozen")
    p = str(root / "frozen" / ba.FROZEN_NAME)

    def install(**kw):
        if os.path.exists(p):
            os.chmod(p, 0o644)
            os.remove(p)
        n = _make_frozen(p, **kw)
        monkeypatch.setattr(ba, "FROZEN_BYTES", os.path.getsize(p))
        monkeypatch.setattr(ba, "FROZEN_SHA256", hashlib.sha256(open(p, "rb").read()).hexdigest())
        monkeypatch.setattr(ba, "FROZEN_ROWS", n)
        ba._FROZEN.update(stat=None, data=None, error=None)
        ba._LIVE.update(stat=None, data=None)
        return p
    install()
    return install


# ── fail closed ───────────────────────────────────────────────────────────────
def test_v1_is_the_default_and_the_seam_is_inert(monkeypatch, tmp_path):
    monkeypatch.delenv("BREADTH_AUTHORITY", raising=False)
    rows = [{"date": "2026-09-24", "pct_above_50sma": 12.3}]
    assert ba.mode() == "v1" and not ba.in_force()
    assert ba.overlay_monitor_rows(rows, ()) == [{"date": "2026-09-24", "pct_above_50sma": 12.3}]
    assert ba.chart_bars("pct_above_50sma", {}) is None
    assert ba.token() == "v1"


def test_a_frozen_replica_with_the_wrong_bytes_is_never_served(v2, monkeypatch):
    monkeypatch.setattr(ba, "FROZEN_SHA256", "0" * 64)
    ba._FROZEN.update(stat=None, data=None)
    ok, why = ba.available()
    assert not ok and "sha256" in why
    rows = [{"date": "2026-09-24", "pct_above_50sma": 12.3}]
    assert ba.overlay_monitor_rows(rows, ())[0]["pct_above_50sma"] == 12.3   # V1 untouched
    assert ba.chart_bars("pct_above_50sma", {}) is None


def test_the_pit_gap_set_must_equal_the_owner_ruling(v2):
    v2(gaps=("2026-03-24", "2026-08-31"))
    ok, why = ba.available()
    assert not ok and "PIT gaps" in why


def test_an_untrusted_source_in_the_artifact_refuses_it(v2):
    v2(extra_source="reconstruct")
    assert not ba.available()[0]


def test_a_canonical_uct_row_before_v2_start_refuses_it(v2):
    v2(uct_before_start=True)
    assert not ba.available()[0]


# ── the boundaries ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("d,cls", [
    ("2026-03-20", ba.V1_LEGACY), ("2026-03-22", ba.V1_LEGACY),
    ("2026-03-23", ba.V2_FROZEN), ("2026-03-24", ba.V2_GAP), ("2026-03-25", ba.V2_FROZEN),
    ("2026-08-31", ba.V2_GAP), ("2026-09-23", ba.V2_GAP), ("2026-09-24", ba.V2_FROZEN),
])
def test_every_boundary_session_has_exactly_one_authority(v2, d, cls):
    assert ba.available()[0]
    assert ba.session_authority(d) == cls


def test_the_provisional_tail_is_the_newest_collector_sessions_only(v2):
    tail = ("2026-09-25", "2026-09-28", "2026-09-29")
    assert ba.session_authority("2026-09-29", tail) == ba.PROVISIONAL
    assert ba.session_authority("2026-09-28", tail) == ba.PROVISIONAL
    assert ba.session_authority("2026-09-25", tail) == ba.V2_PENDING      # fail closed


def test_body_rows_are_served_as_bodies_with_their_provenance(v2):
    r = ba.v2_rows("2026-09-01")["pct_above_50sma"]
    assert r[4] == "intraday_recon_1m_body" and r[0] == r[1] == r[2] == r[3]
    assert ba.status()["frozen"]["body_rows_uct"] == 1
    bars = ba.chart_bars("pct_above_50sma", {})
    assert bars["2026-09-01"][:4] == r[:4]


def test_every_frozen_uct_row_is_servable(v2):
    f = ba._load_frozen()
    n = sum(len(v) for v in f["rows"].values())
    assert n == (len(SESSIONS) - len(ba.PIT_GAPS_RULED)) * len(M)
    for m in M:
        bars = ba.chart_bars(m, {})
        assert set(bars) == set(SESSIONS) - set(ba.PIT_GAPS_RULED)


# ── live publications ────────────────────────────────────────────────────────
def _pub(d="2026-09-25", pit_rejected=False, source="intraday_recon_1m", drop=None, **prov):
    rows = [] if pit_rejected else [["uct", m, 1.0, 2.0, 0.5, 1.5, source] for m in M if m != drop]
    rows += [["us", m, 1.0, 2.0, 0.5, 1.5, "intraday_recon_1m"] for m in M]
    p = {"methodology": "rth-1m-composites-v2c2-div+ema-tie-v1", "producer_version": "t",
         "vintage_tag": "v1", "input_manifest_sha256": "a", "pit_ledger_sha256": "b",
         "reference_sha256": "c", "validated_at": "2026-09-26T21:00:00Z",
         "membership_sha256": {"uct": "PIT_REJECTED" if pit_rejected else "m1", "us": "m2"}}
    p.update(prov)
    body = gzip.compress(json.dumps({"date": d, "pub_id": "P-" + d, "state": "VALIDATED",
                                     "provenance": p, "rows": rows}).encode())
    return body, {"date": d, "state": "VALIDATED", "sha256": hashlib.sha256(body).hexdigest()}


def test_a_validated_publication_becomes_the_live_authority(v2):
    b, e = _pub()
    assert ba.adopt_publication(b, e) == "adopted"
    assert ba.session_authority("2026-09-25", ("2026-09-25",)) == ba.V2_LIVE
    assert ba.v2_rows("2026-09-25")["pct_above_50sma"][3] == 1.5
    assert ba.adopt_publication(b, e) == "same"


def test_an_accepted_session_is_never_silently_rewritten(v2):
    b, e = _pub()
    ba.adopt_publication(b, e)
    b2, e2 = _pub(producer_version="rerun-months-later")
    assert ba.adopt_publication(b2, e2).startswith("refused: session 2026-09-25 already accepted")
    assert ba.status()["live"]["conflicts"]
    assert ba._load_live()["sessions"]["2026-09-25"]["sha256"] == e["sha256"]


@pytest.mark.parametrize("kw,why", [
    ({"source": "live"}, "outside the V2 contract"),
    ({"source": "close_recon"}, "outside the V2 contract"),
    ({"drop": "pct_above_50sma"}, "incomplete"),
    ({"validated_at": ""}, "provenance missing"),
    ({"d": "2026-09-24"}, "not a live-period"),
])
def test_publications_outside_the_contract_are_refused(v2, kw, why):
    b, e = _pub(**kw)
    out = ba.adopt_publication(b, e)
    assert out.startswith("refused") and why in out


def test_a_pit_rejected_live_session_is_an_honest_gap(v2):
    b, e = _pub(pit_rejected=True)
    assert ba.adopt_publication(b, e) == "adopted"
    assert ba.session_authority("2026-09-25", ("2026-09-25",)) == ba.V2_GAP
    assert "2026-09-25" not in ba.chart_bars("pct_above_50sma", {"2026-09-25": 99.0})


def test_a_tampered_publication_is_refused(v2):
    b, e = _pub()
    assert ba.adopt_publication(b + b"x", e).startswith("refused")


# ── the Monitor overlay ──────────────────────────────────────────────────────
def test_monitor_rows_take_v2_values_keep_other_fields_and_mark_authority(v2):
    rows = [
        {"date": "2026-03-20", "pct_above_50sma": 11.0, "vix": 20.0, "mcclellan_osc": 5.0},
        {"date": "2026-03-23", "pct_above_50sma": 12.0, "vix": 21.0, "mcclellan_osc": 6.0},
        {"date": "2026-03-24", "pct_above_50sma": 13.0, "vix": 22.0},
        {"date": "2026-09-24", "pct_above_50sma": 14.0, "vix": 23.0},
        {"date": "2026-09-29", "pct_above_50sma": 15.0, "vix": 24.0},
    ]
    ba.overlay_monitor_rows(rows, ("2026-09-29",))
    by = {r["date"]: r for r in rows}
    assert by["2026-03-20"] == {"date": "2026-03-20", "pct_above_50sma": 11.0, "vix": 20.0,
                                "mcclellan_osc": 5.0}                      # legacy untouched
    assert by["2026-03-23"]["pct_above_50sma"] == _val("2026-03-23", "pct_above_50sma")
    assert by["2026-03-23"]["vix"] == 21.0                                   # non-Breadth kept
    assert by["2026-03-23"]["mcclellan_osc"] is None                         # pending decision
    assert by["2026-03-23"]["_authority"] == ba.V2_FROZEN
    assert by["2026-03-24"]["_authority"] == ba.V2_GAP
    assert all(by["2026-03-24"][m] is None for m in M)                       # no substitution
    assert by["2026-09-29"]["_authority"] == ba.PROVISIONAL
    assert by["2026-09-29"]["pct_above_50sma"] == 15.0
    # a V2 session the collector never wrote (a V1 hole) joins the window
    assert "2026-09-22" in by and by["2026-09-22"]["_authority"] == ba.V2_FROZEN


# ── through the real readers ─────────────────────────────────────────────────
@pytest.fixture
def monitor(v2, tmp_path, monkeypatch):
    from api.services import breadth_daily_ohlc as ohlc
    from api.services import breadth_monitor as bm
    from api.services import breadth_sentiment_history as sent
    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "monitor.db"))
    monkeypatch.setattr(ohlc, "_db_path", lambda: str(tmp_path / "ohlc.db"))
    monkeypatch.setattr(sent, "_db_path", lambda: str(tmp_path / "sent.db"))
    monkeypatch.setattr(ohlc, "_INIT_DONE", False)
    monkeypatch.setattr(sent, "_INIT_DONE", False)

    class _NoCache:
        def get(self, *_a, **_k): return None
        def set(self, *_a, **_k): return None
        def delete_prefix(self, *_a, **_k): return None
    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()
    ohlc._ensure_init()
    for d in ("2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19", "2026-03-20",
              "2026-03-23", "2026-03-24", "2026-03-25", "2026-09-24", "2026-09-29"):
        bm.store_snapshot(d, {"pct_above_50sma": 40.0, "up_4pct_today": 100, "down_4pct_today": 50,
                              "adv_decline": 10, "universe_count": 3000, "new_52w_highs": 30,
                              "new_52w_lows": 3, "magna_up": 300, "magna_down": 100,
                              "stage2_count": 600, "vix": 18.0, "cboe_putcall": 0.8,
                              "aaii_spread": -5.0, "mcclellan_osc": 42.0})
    return bm


def test_monitor_v1_mode_is_byte_identical(monitor, monkeypatch):
    monkeypatch.setenv("BREADTH_AUTHORITY", "v1")
    rows = {r["date"]: r for r in monitor.get_history(10)}
    assert "_authority" not in rows["2026-03-23"]
    assert rows["2026-03-23"]["mcclellan_osc"] == 42.0
    assert rows["2026-03-23"]["pct_above_50sma"] == 40.0


def test_monitor_v2_direct_derived_and_pending_fields(monitor):
    rows = {r["date"]: r for r in monitor.get_history(15)}
    frozen = ba.v2_rows("2026-03-23")
    r = rows["2026-03-23"]
    assert r["_authority"] == ba.V2_FROZEN
    for m in ("pct_above_50sma", "ratio_5day", "hi_ratio", "net_new_high_low"):
        assert r[m] == frozen[m][3], m                  # DIRECT V2 — never recomputed from V1 rows
    assert r["mcclellan_osc"] is None and r["adv_decline_cum"] is None   # decision pending
    assert r["breadth_score"] is not None                                # derived from V2 + sentiment
    g = rows["2026-03-24"]
    assert g["_authority"] == ba.V2_GAP
    assert g["ratio_5day"] is None and g["pct_above_50sma"] is None
    assert g["breadth_score"] is None                                   # no fake derived certainty
    assert g["vix"] == 18.0                                             # the session still happened
    legacy = rows["2026-03-20"]
    assert "_authority" not in legacy and legacy["mcclellan_osc"] == 42.0
    assert rows["2026-09-29"]["_authority"] == ba.PROVISIONAL
    assert rows["2026-09-29"]["pct_above_50sma"] == 40.0                # collector value, flagged
    assert rows["2026-09-22"]["_authority"] == ba.V2_FROZEN             # V1 hole filled by V2


def test_provisional_becomes_canonical_when_v2_validates(monitor):
    b, e = _pub(d="2026-09-29")
    assert ba.adopt_publication(b, e) == "adopted"
    r = {x["date"]: x for x in monitor.get_history(15)}["2026-09-29"]
    assert r["_authority"] == ba.V2_LIVE and r["pct_above_50sma"] == 1.5
    assert r["_provenance"]["publication_sha256"] == e["sha256"]


def test_chart_series_splices_legacy_v2_gaps_and_provisional(monitor, monkeypatch):
    from api.services import breadth_symbols as bs
    from api.services import breadth_daily_ohlc as ohlc
    ohlc.write_bulk([("2026-03-19", "pct_above_50sma", 30, 31, 29, 30.5),
                     ("2026-03-23", "pct_above_50sma", 1, 1, 1, 1)], source="intraday_recon")
    daily = {b["t"]: b for b in bs._build_breadth_series("UCTA50", "pct_above_50sma")}
    assert daily["2026-03-19"]["c"] == 40.0                    # legacy: collector close (V1 rule)
    fr = ba.v2_rows("2026-03-23")["pct_above_50sma"]
    assert (daily["2026-03-23"]["o"], daily["2026-03-23"]["h"], daily["2026-03-23"]["c"]) == \
        (round(fr[0], 4), round(fr[1], 4), round(fr[3], 4))    # V2 OHLC, not the V1 store
    assert "2026-03-24" not in daily and "2026-09-23" not in daily   # honest gaps
    assert daily["2026-09-29"]["c"] == 40.0                    # provisional collector body
    body = ba.v2_rows("2026-09-01")["pct_above_50sma"]
    assert daily["2026-09-01"]["h"] == daily["2026-09-01"]["l"] == round(body[3], 4)
    assert bs._build_breadth_series("UCTMC", "mcclellan_osc")[-1]["t"] < ba.V2_START \
        if bs._build_breadth_series("UCTMC", "mcclellan_osc") else True
