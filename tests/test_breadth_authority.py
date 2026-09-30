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


@pytest.fixture(autouse=True)
def _fresh_memos():
    ba._DERIVED_MEMO.clear()
    ba._LEGACY_MEMO.update(at=0.0, data=None)
    yield


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
def test_monitor_rows_take_v2_values_keep_other_fields_and_mark_authority(v2, monkeypatch):
    monkeypatch.setattr(ba, "legacy_ad_cum", lambda frm="0000": {"2026-03-20": 777.0})
    rows = [
        {"date": "2026-03-20", "pct_above_50sma": 11.0, "vix": 20.0, "mcclellan_osc": 5.0},
        {"date": "2026-03-23", "pct_above_50sma": 12.0, "vix": 21.0, "mcclellan_osc": 6.0},
        {"date": "2026-03-24", "pct_above_50sma": 13.0, "vix": 22.0},
        {"date": "2026-09-24", "pct_above_50sma": 14.0, "vix": 23.0},
        {"date": "2026-09-29", "pct_above_50sma": 15.0, "vix": 24.0},
    ]
    ba.overlay_monitor_rows(rows, ("2026-09-29",))
    by = {r["date"]: r for r in rows}
    assert {k: by["2026-03-20"][k] for k in ("pct_above_50sma", "vix", "mcclellan_osc")} == \
        {"pct_above_50sma": 11.0, "vix": 20.0, "mcclellan_osc": 5.0}            # legacy V1 values kept
    assert by["2026-03-20"]["adv_decline_cum"] == 777.0                      # full-history A/D lineage
    assert "_authority" not in by["2026-03-20"]
    assert by["2026-03-23"]["pct_above_50sma"] == _val("2026-03-23", "pct_above_50sma")
    assert by["2026-03-23"]["vix"] == 21.0                                   # non-Breadth kept
    assert by["2026-03-23"]["mcclellan_osc"] == _mcc_after_seed([_val("2026-03-23", "adv_decline")])
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


def test_monitor_v2_direct_and_derived_fields(monitor):
    rows = {r["date"]: r for r in monitor.get_history(15)}
    frozen = ba.v2_rows("2026-03-23")
    r = rows["2026-03-23"]
    assert r["_authority"] == ba.V2_FROZEN
    for m in ("pct_above_50sma", "ratio_5day", "hi_ratio", "net_new_high_low"):
        assert r[m] == frozen[m][3], m                  # DIRECT V2 — never recomputed from V1 rows
    assert r["mcclellan_osc"] == _mcc_after_seed([frozen["adv_decline"][3]])
    assert r["adv_decline_cum"] == ba.AD_BRIDGE["seed_value"] + frozen["adv_decline"][3]
    assert r["breadth_score"] is not None                                # derived from V2 + sentiment
    g = rows["2026-03-24"]
    assert g["_authority"] == ba.V2_GAP
    assert g["ratio_5day"] is None and g["pct_above_50sma"] is None
    assert g["breadth_score"] is None                                   # no fake derived certainty
    assert g["vix"] == 18.0                                             # the session still happened
    legacy = rows["2026-03-20"]
    assert "_authority" not in legacy and legacy["mcclellan_osc"] == 42.0     # legacy published McClellan
    assert legacy["adv_decline_cum"] == 10.0 * 5          # full-history lineage: 5 collector rows <= 03-20
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
    mc = {b["t"]: b for b in bs._build_breadth_series("UCTMC", "mcclellan_osc")}
    assert mc["2026-03-20"]["c"] == 42.0                                     # legacy V1 published
    assert mc["2026-03-23"]["c"] == _mcc_after_seed([ba.v2_rows("2026-03-23")["adv_decline"][3]])
    assert "2026-03-24" not in mc and "2026-09-23" not in mc                # gaps emit no value
    ad = {b["t"]: b["c"] for b in bs._build_breadth_series("UCTAD", "adv_decline_cum")}
    assert ad["2026-03-20"] == 50.0 and ad["2026-03-23"] == ba.AD_BRIDGE["seed_value"] + \
        ba.v2_rows("2026-03-23")["adv_decline"][3]



# ── the derived-field bridges (owner rulings 2026-09-29) ─────────────────────
A19, A39 = 2.0 / 20, 2.0 / 40


def _mcc_after_seed(values):
    e19, e39 = ba.MCCLELLAN_BRIDGE["ema19_seed"], ba.MCCLELLAN_BRIDGE["ema39_seed"]
    for v in values:
        e19 = A19 * v + (1 - A19) * e19
        e39 = A39 * v + (1 - A39) * e39
    return round(e19 - e39, 1)


def test_the_pinned_seeds_are_the_audited_values():
    m, a = ba.MCCLELLAN_BRIDGE, ba.AD_BRIDGE
    assert ba.SEED_SESSION == "2026-03-20" and m["seed_session"] == a["seed_session"] == "2026-03-20"
    assert (m["ema19_seed"], m["ema39_seed"]) == (-447.32198711685294, -243.95100545909787)
    assert m["ema19_seed"] - m["ema39_seed"] == m["reconstructed_osc_at_seed"]
    assert round(m["reconstructed_osc_at_seed"], 1) - m["stored_v1_osc_at_seed"] == pytest.approx(m["accepted_discontinuity"])
    assert a["seed_value"] == 806344.0 and a["seed_value"] != -995
    assert m["v2_input_start"] == a["v2_input_start"] == "2026-03-23"


def test_first_update_gap_hold_and_resume(v2):
    d = ba.derived_uct()
    v = lambda x: ba.v2_rows(x)["adv_decline"][3]
    assert d["2026-03-23"]["mcclellan_osc"] == _mcc_after_seed([v("2026-03-23")])
    assert d["2026-03-24"] == {"mcclellan_osc": None, "adv_decline_cum": None, "authority": ba.V2_GAP}
    # the gap neither feeds zero nor decays: 03-25 == seed + 03-23 + 03-25 exactly
    assert d["2026-03-25"]["mcclellan_osc"] == _mcc_after_seed([v("2026-03-23"), v("2026-03-25")])
    assert d["2026-03-25"]["adv_decline_cum"] == (806344.0 + v("2026-03-23")) + v("2026-03-25")
    zero_fed = _mcc_after_seed([v("2026-03-23"), 0.0, v("2026-03-25")])
    assert d["2026-03-25"]["mcclellan_osc"] != zero_fed or v("2026-03-23") == 0      # missing != zero
    seq = [v(x) for x in ("2026-03-23", "2026-03-25")]
    assert d["2026-08-31"]["mcclellan_osc"] is None and d["2026-08-31"]["adv_decline_cum"] is None
    seq.append(v("2026-09-01"))
    assert d["2026-09-01"]["mcclellan_osc"] == _mcc_after_seed(seq)
    assert d["2026-09-23"]["mcclellan_osc"] is None
    seq += [v("2026-09-22"), v("2026-09-24")]
    assert d["2026-09-24"]["mcclellan_osc"] == _mcc_after_seed(seq)
    run = 806344.0
    for x in seq:
        run += x
    assert d["2026-09-24"]["adv_decline_cum"] == run
    assert d["2026-09-23"]["adv_decline_cum"] is None


def test_no_v1_and_no_uct_backtest_input_enters_the_recurrence(v2, tmp_path, monkeypatch):
    before = ba.derived_uct()
    # poisoning every non-uct universe of the artifact, and any V1 value offered for a canonical
    # session, must not move one derived value
    p = ba.frozen_path()
    import sqlite3 as _sq
    os.chmod(p, 0o644)
    c = _sq.connect(p)
    c.execute("UPDATE breadth_daily_ohlc SET c = c + 1000 WHERE universe <> 'uct'")
    c.commit(); c.close()
    import hashlib as _h
    monkeypatch.setattr(ba, "FROZEN_SHA256", _h.sha256(open(p, "rb").read()).hexdigest())
    monkeypatch.setattr(ba, "FROZEN_BYTES", os.path.getsize(p))
    ba._FROZEN.update(stat=None, data=None)
    assert ba.available()[0], ba.available()
    after = ba.derived_uct({"2026-03-23": 99999.0, "2026-09-24": -99999.0})    # "V1" offers ignored
    assert {k: v for k, v in after.items() if k <= ba.FROZEN_END} == {k: v for k, v in before.items() if k <= ba.FROZEN_END}


def test_provisional_tail_continues_flagged_and_is_replaced_by_canonical(v2):
    d = ba.derived_uct({"2026-09-29": 100.0}, ("2026-09-29",))
    assert d["2026-09-29"]["authority"] == ba.PROVISIONAL
    assert d["2026-09-29"]["adv_decline_cum"] == d["2026-09-24"]["adv_decline_cum"] + 100.0
    b, e = _pub(d="2026-09-25")
    ba.adopt_publication(b, e)
    d2 = ba.derived_uct({"2026-09-29": 100.0}, ("2026-09-29",))
    assert d2["2026-09-25"]["authority"] == ba.V2_LIVE
    assert d2["2026-09-29"]["adv_decline_cum"] == d2["2026-09-25"]["adv_decline_cum"] + 100.0


def test_ad_and_mcclellan_are_window_independent_across_readers(monitor):
    a = {r["date"]: (r["adv_decline_cum"], r["mcclellan_osc"]) for r in monitor.get_history(4)}
    b = {r["date"]: (r["adv_decline_cum"], r["mcclellan_osc"]) for r in monitor.get_history(20)}
    c = {r["date"]: (r["adv_decline_cum"], r["mcclellan_osc"]) for r in monitor.get_history_deep(20)}
    for d in a:
        assert a[d] == b[d] == c.get(d, a[d]), d


def test_the_seed_check_reports_drift_from_the_live_v1_stores(monitor):
    chk = ba.seed_check()
    assert chk["sessions"] == 5 and chk["ad"] == 50.0
    assert chk["ad_seed_matches"] is False and chk["lineage_matches"] is False      # a fixture, not production



# ── US: independent authority over the full V2 history (owner ruling 2026-09-29) ─────────
@pytest.fixture
def us_store(monitor, monkeypatch):
    """V1 `us` rows (the defective-population store) + the four V1-only volume metrics."""
    from api.services import breadth_daily_ohlc as ohlc
    rows = [(d, m, 1.0, 2.0, 0.5, 1.5) for d in SESSIONS for m in ("pct_above_50sma", "advancing", "declining",
                                                                   "adv_decline", "universe_count") + ba.US_WITHHELD]
    monkeypatch.setattr(ohlc, "compat_index_present", lambda c=None: False)
    ohlc.write_bulk(rows, source="close_recon", universe="us")
    return ohlc


def test_us_stays_v1_while_its_own_gate_is_unset(us_store, monkeypatch):
    monkeypatch.delenv("BREADTH_AUTHORITY_US", raising=False)
    assert ba.us_mode() == "v1" and ba.in_force()                   # UCT is V2, US is not
    h = us_store.history("pct_above_50sma", universe="us")
    assert set(h) == set(SESSIONS) and all(v["c"] == 1.5 for v in h.values())
    assert us_store.history("up_vol_ratio", universe="us")["2026-09-24"]["c"] == 1.5
    assert ba.universe_history("pct_above_50sma", "us") is None


def test_us_v2_owns_the_whole_history_with_no_uct_boundary_and_no_gaps(us_store, monkeypatch):
    monkeypatch.setenv("BREADTH_AUTHORITY_US", "v2")
    h = us_store.history("pct_above_50sma", universe="us")
    assert set(h) == set(SESSIONS)                                  # 03-24/08-31/09-23 are NOT us gaps
    for d in SESSIONS:
        assert h[d]["c"] == _val(d, "pct_above_50sma")              # V2, never the V1 1.5
    assert us_store.dates_since("us", "2026-09-01") == [d for d in SESSIONS if d >= "2026-09-01"]
    assert ba.universe_history("pct_above_50sma", "uct") is None     # the store hook never reroutes uct


@pytest.mark.parametrize("m", ba.US_WITHHELD)
def test_the_four_v1_only_volume_metrics_are_withheld_under_v2(us_store, monkeypatch, m):
    monkeypatch.setenv("BREADTH_AUTHORITY_US", "v2")
    assert us_store.history(m, universe="us") == {}                 # unavailable — not V1, not zero
    monkeypatch.setenv("BREADTH_AUTHORITY_US", "v1")
    assert us_store.history(m, universe="us")["2026-09-24"]["c"] == 1.5   # V1 exactly as before


def test_us_live_publications_extend_the_tail(us_store, monkeypatch):
    b, e = _pub(d="2026-09-25")
    ba.adopt_publication(b, e)
    monkeypatch.setenv("BREADTH_AUTHORITY_US", "v2")
    h = us_store.history("pct_above_50sma", universe="us")
    assert h["2026-09-25"]["c"] == 1.5 and max(h) == "2026-09-25"   # the live publication's us row
    assert "2026-09-25" in us_store.dates_since("us", "2026-09-20")


def test_uct_is_byte_identical_whatever_the_us_gate_says(us_store, monitor, monkeypatch):
    import json as _j
    from api.services import breadth_symbols as bs
    out = {}
    for us in ("v1", "v2"):
        monkeypatch.setenv("BREADTH_AUTHORITY_US", us)
        ba._DERIVED_MEMO.clear()
        rows = monitor.get_history(15)
        mc = bs._build_breadth_series("UCTMC", "mcclellan_osc")
        out[us] = _j.dumps([rows, mc], sort_keys=True, default=str)
    assert out["v1"] == out["v2"]


def test_the_token_is_unchanged_while_us_is_v1_and_moves_when_it_switches(v2, monkeypatch):
    monkeypatch.delenv("BREADTH_AUTHORITY_US", raising=False)
    t1 = ba.token()
    assert t1.startswith("v2:") and not t1.endswith("us-v2")
    monkeypatch.setenv("BREADTH_AUTHORITY_US", "v2")
    assert ba.token() == t1 + ":us-v2"
    monkeypatch.setenv("BREADTH_AUTHORITY", "v1")
    assert ba.token().startswith("v1:") and ba.token().endswith(":us-v2")     # US alone still keyed
    monkeypatch.setenv("BREADTH_AUTHORITY_US", "v1")
    assert ba.token() == "v1"


def test_us_market_indicators_recompute_from_v2_and_are_window_independent(us_store, monkeypatch):
    from api.services.market_indicators import producers as mp
    monkeypatch.setenv("BREADTH_AUTHORITY_US", "v2")
    ad = mp.ad_line_for_universe("us")
    run, want = 0.0, {}
    for d in SESSIONS:
        run += _val(d, "adv_decline")
        want[d] = run
    assert dict(zip(ad.dates, ad.values)) == want                  # full V2 history, from 0
    z = mp.zweig_for_universe("us")
    assert z.dates == SESSIONS and all(v is not None for v in z.values)
    # the loaders read the WHOLE history regardless of any display window
    full = mp.load_pair("advancing", "declining", "us")
    short = mp.load_pair("advancing", "declining", "us", limit=3)
    assert full[0][-3:] == short[0] and full[1][-3:] == short[1]
    assert mp._authority_suffix().endswith(":us-v2")


def test_breadth_deep_history_is_never_served_immutable(monkeypatch):
    from api.routers import bars as br
    from api.services import breadth_symbols as bs
    bars = [{"t": "2026-09-%02d" % i, "o": 1, "h": 1, "l": 1, "c": 1, "v": 0} for i in (21, 22, 23, 24, 25)]
    monkeypatch.setattr(bs, "is_breadth_symbol", lambda t: t == "USA50")
    monkeypatch.setattr(bs, "build_breadth_bars", lambda *a, **k: {"bars": bars})
    r = br.serve_bars_history("USA50", "D", 400, "", "2026-09-24")
    assert "immutable" not in r.headers["Cache-Control"]
