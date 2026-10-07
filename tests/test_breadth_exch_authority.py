"""NYSE + NASDAQ member authority: ONE pointer over frozen historical + frozen derived + the accepted live
append. Publish → proven → atomic switch; reader follows; rollback restores; every failure leaves the
previous authority serving; FAIL CLOSED when in force and unavailable; registry/library follow the seam."""
from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3

import pytest

from api.services import breadth_exchange_authority as ea
from api.services import breadth_exchange_publish as ep

LIVE = ["2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]
METRICS = ("advancing", "declining", "universe_count", "pct_above_50sma", "new_52w_highs", "adv_decline")


def _days(a, b):
    cal, d, out = ea._cal(), dt.date.fromisoformat(a), []
    while d.isoformat() <= b:
        if cal.is_trading_day(d.isoformat()):
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def _ad(u, d):
    """Deterministic, distinct advancing/declining per universe/date."""
    n = int(d.replace("-", "")) % 97
    return (1000.0 + n * 7 + (5 if u == "nyse" else 0), 900.0 + (n * 13) % 300)


@pytest.fixture
def world(tmp_path, monkeypatch):
    lc = ea._lc()
    monkeypatch.setattr(lc, "BURN_IN", 3)                      # exercise MCO/MCS inside a short fixture
    start = {"nyse": "2026-09-08", "nasdaq": "2026-09-01"}
    monkeypatch.setattr(ea, "START", start)
    hist_days = _days("2026-09-01", ea.FROZEN_END)
    hist, der = str(tmp_path / "hist.db"), str(tmp_path / "der.db")
    h = sqlite3.connect(hist)
    h.execute("CREATE TABLE breadth_daily_ohlc (universe TEXT, date TEXT, metric TEXT, o REAL, h REAL, l REAL, "
              "c REAL, source TEXT, PRIMARY KEY (universe, date, metric))")
    dz = sqlite3.connect(der)
    dz.execute("CREATE TABLE derived_series (series TEXT, date TEXT, value REAL, PRIMARY KEY (series, date))")
    state = {}
    for u in ("nyse", "nasdaq"):
        st = {"ad": None, "ema_fast": None, "ema_slow": None, "valid_obs": 0, "mcs": None}
        for d in hist_days:
            if d < start[u]:
                continue
            a, de = _ad(u, d)
            for m in METRICS:
                v = {"advancing": a, "declining": de, "universe_count": 3000.0}.get(m, 50.0)
                h.execute("INSERT INTO breadth_daily_ohlc VALUES(?,?,?,?,?,?,?,?)",
                          (u, d, m, v, v, v, v, "intraday_recon_1m"))
            st, out = lc.derive_step(st, a, de)
            for k in ea.DERIVED_KINDS:
                if out[k] is not None:
                    dz.execute("INSERT INTO derived_series VALUES(?,?,?)", ("%s:%s" % (ea.EXCHANGE_OF[u], k), d, out[k]))
        state[u] = st
    h.commit()
    dz.commit()
    h.close()
    dz.close()
    monkeypatch.setattr(ea, "HIST_SHA256", ea.sha_file(hist))
    monkeypatch.setattr(ea, "DER_SHA256", ea.sha_file(der))
    store_dir = tmp_path / "store"
    store_dir.mkdir()
    live = str(store_dir / "exch_live_candidate_v1.db")
    s = lc.Store(live)
    s.init_lineage({"mode": "append", "historical_sha256": ea.HIST_SHA256, "derived_sha256": ea.DER_SHA256,
                    "ledger_sha256": ea.LEDGER_SHA256, "identity_parent_sha256": ea.IDENTITY_PARENT_SHA256,
                    "pins_sha256": ea.PINS_SHA256, "owner_vintage_exceptions_sha256": ea.EXCEPTIONS_SHA256,
                    "code_commit": "03a78ad30", "frozen_end": ea.FROZEN_END, "nyse_start": start["nyse"],
                    "nasdaq_start": start["nasdaq"], "substitution": "{}", "pinned_vintage": "",
                    "authority": "NOT member-authoritative"})
    s.c.close()
    monkeypatch.setattr(ea, "START", start)

    def append(d, tamper=None):
        st_ = lc.Store(live)
        rows, derived, trend = [], [], []
        for u in ("nyse", "nasdaq", "us"):
            a, de = _ad(u, d)
            for m in METRICS:
                v = {"advancing": a, "declining": de, "universe_count": 3000.0}.get(m, 51.0)
                rows.append((u, d, m, v, v, v, v, "intraday_recon_1m"))
            if u == "us":
                continue
            stt, out = lc.derive_step(state[u], a, de)
            state[u] = stt
            X = ea.EXCHANGE_OF[u]
            for k in ea.DERIVED_KINDS:
                if out[k] is not None:
                    derived.append(("%s:%s" % (X, k), d, out[k] + (tamper or 0.0)))
            trend.append((X, d, stt["ad"], stt["ema_fast"], stt["ema_slow"], stt["valid_obs"], stt["mcs"]))
        payload = {"rows": rows, "counts": {"NYSE": 1, "NASDAQ": 1, "us": 2, "OTHER": 0, "UNRESOLVED": 0,
                                            "CONFLICT": 0, "absent": 0},
                   "membership": [(d, "A", "A@x", "NYSE", "bridge", None), (d, "B", "B@x", "NASDAQ", "bridge", None)],
                   "evidence": [], "derived": derived, "trend": trend, "vintage": "pX", "compute_vintage": "pX",
                   "vintage_exception": "", "input_manifest_sha256": "i", "reference_sha256": "r",
                   "us_v2_pub_id": d + "-pX", "venue_source": "bridge", "rows_sha256": lc.rows_sha(rows),
                   "membership_sha256": "m", "derived_sha256": "d", "identity_state_sha256": "s",
                   "provenance": {"run_code_commit": "test"}, "completed_at": "t"}
        st_.commit_session(d, d, payload)
        st_.c.close()

    obj = ea.DirStore(str(tmp_path / "objects"))
    monkeypatch.setenv("BREADTH_EXCH_DIR", str(tmp_path / "replica"))
    monkeypatch.setenv("BREADTH_AUTHORITY_EXCH", "v1")
    ea._VIEW.update(stat=None, data=None, error=None)
    ea._MEMO.clear()
    w = {"hist": hist, "der": der, "live": live, "store": obj, "append": append, "tmp": tmp_path,
         "replica": str(tmp_path / "replica")}
    w["publish"] = lambda **k: ep.publish(obj, live, hist, der, "cafe1234", **k)
    w["sync"] = lambda: ea.sync_once(obj)
    return w


def _closes(u="nyse", m="advancing"):
    return {d: r["c"] for d, r in (ea.universe_history(m, u) or {}).items()}


# ── one continuous authority ─────────────────────────────────────────────────────────────────────
def test_publish_install_and_serve_one_continuous_series(world):
    for d in LIVE[:5]:
        world["append"](d)
    r = world["publish"]()
    assert r["published"] == 1 and r["proof"]["latest_session"] == "2026-10-01"
    assert world["sync"]()["result"] == "installed"
    s = _closes("nasdaq")
    days = sorted(s)
    assert days[0] == "2026-09-01" and days[-1] == "2026-10-01"                 # beginning … latest
    assert days == _days("2026-09-01", "2026-10-01")                            # no duplicate / missing session
    assert "2026-09-24" in s and "2026-09-25" in s                              # the boundary, both sides
    assert s["2026-09-15"] == _ad("nasdaq", "2026-09-15")[0]                     # middle
    assert s["2026-09-25"] == _ad("nasdaq", "2026-09-25")[0]
    assert min(_closes("nyse")) == "2026-09-08"                                 # NYSE canonical start
    assert "2026-09-04" not in _closes("nyse")                                  # unsupported session → absent
    assert "2026-10-02" not in s                                                # not yet in the authority
    assert ea.universe_history("no_such_metric", "nyse") == {}
    assert ea.universe_history("advancing", "us") is None                       # not an exchange universe
    assert ea.universe_dates("nyse", "2026-09-29") == ["2026-09-29", "2026-09-30", "2026-10-01"]


def test_derived_is_continuous_across_the_boundary_and_absent_in_burn_in(world):
    for d in LIVE[:3]:
        world["append"](d)
    world["publish"]()
    world["sync"]()
    lc = ea._lc()
    for u in ("nyse", "nasdaq"):
        X = ea.EXCHANGE_OF[u]
        ad, mco, mcs = (ea.derived("%s:%s" % (X, k)) for k in ("AD", "MCO", "MCS"))
        st = {"ad": None, "ema_fast": None, "ema_slow": None, "valid_obs": 0, "mcs": None}
        for d in sorted(set(ad)):                                               # one pass, no reset, no 2nd burn-in
            a, de = _ad(u, d)
            st, out = lc.derive_step(st, a, de)
            assert ad[d] == out["AD"] and mco.get(d) == out["MCO"] and mcs.get(d) == out["MCS"]
        first = sorted(ad)[:3]
        assert all(d not in mco and d not in mcs for d in first)                # burn-in → absent, never 0
        assert ea.derived("US:MCO") is None and ea.derived("NYSE:XYZ") is None


# ── publish → switch → follow → rollback ────────────────────────────────────────────────────────
def test_new_publication_is_followed_and_rollback_restores(world):
    for d in LIVE[:5]:
        world["append"](d)
    world["publish"]()
    world["sync"]()
    tok1 = ea.token()
    assert max(_closes()) == "2026-10-01"
    world["append"](LIVE[5])
    r2 = world["publish"]()
    assert r2["published"] == 2 and r2["previous"]["publication_version"] == 1
    assert max(_closes()) == "2026-10-01"                                       # nothing moves before the sync
    assert world["sync"]()["result"] == "installed"
    assert max(_closes()) == "2026-10-02" and ea.token() != tok1                # reader follows; caches re-key
    rb = ep.rollback(world["store"], 1)
    assert rb["published"] == 3 and rb["rollback_of"] == 1
    world["sync"]()
    assert max(_closes()) == "2026-10-01"                                       # rollback restores v1 exactly
    assert ea.status()["rollback_of"] == 1 and ea.status()["previous_publication_version"] == 2
    p3 = ep.current(world["store"])["pointer"]
    p1 = ep.history(world["store"], 1)
    assert {a: p3[a]["sha256"] for a in ("historical", "derived", "live")} == \
           {a: p1[a]["sha256"] for a in ("historical", "derived", "live")}      # no rebuild: same artifacts
    held = world["publish"]()
    assert held["published"] is None and held["reason"] == "ROLLBACK_IN_FORCE"  # a rollback HOLDS
    fwd = world["publish"](re_forward=True)
    assert fwd["published"] == 4
    world["sync"]()
    assert max(_closes()) == "2026-10-02"


def test_republishing_identical_content_is_a_noop(world):
    for d in LIVE[:2]:
        world["append"](d)
    assert world["publish"]()["published"] == 1
    again = world["publish"]()
    assert again["published"] is None and again["reason"] == "already current"


# ── atomicity: every failure leaves the previous authority serving ───────────────────────────────
@pytest.mark.parametrize("point", ["after_frozen_upload", "after_live_upload", "before_pointer"])
def test_publish_crash_before_the_pointer_leaves_the_previous_authority(world, point):
    for d in LIVE[:4]:
        world["append"](d)
    world["publish"]()
    world["sync"]()
    before = ep.current(world["store"])["sha256"]
    world["append"](LIVE[4])

    class Boom(Exception):
        pass

    def crash(p):
        if p == point:
            raise Boom(p)
    with pytest.raises(Boom):
        world["publish"](crash=crash)
    assert ep.current(world["store"])["sha256"] == before
    world["sync"]()
    assert max(_closes()) == "2026-09-30"
    assert world["publish"]()["published"] == 2                                 # restart publishes cleanly


def test_a_corrupted_object_is_refused_and_the_installed_authority_keeps_serving(world):
    for d in LIVE[:3]:
        world["append"](d)
    world["publish"]()
    world["sync"]()
    world["append"](LIVE[3])
    world["publish"]()
    cur = ep.current(world["store"])["pointer"]
    k = cur["live"]["key"]
    world["store"].put(k, b"garbage")
    r = world["sync"]()
    assert r["ok"] is False and r["reason"] == "OBJECT_GZ_HASH_MISMATCH"
    assert max(_closes()) == "2026-09-29" and ea.status()["publication_version"] == 1


def test_publisher_refuses_a_set_that_does_not_prove(world, monkeypatch):
    for d in LIVE[:2]:
        world["append"](d)
    world["publish"]()
    world["append"](LIVE[2], tamper=0.5)                                      # live derived ≠ one forward pass
    with pytest.raises(ea.Refused) as e:
        world["publish"]()
    assert e.value.reason == "DERIVED_DISCONTINUITY"
    assert ep.current(world["store"])["pointer"]["publication_version"] == 1


def test_pointer_cannot_move_the_frozen_base_or_name_a_proof_store(world):
    world["append"](LIVE[0])
    world["publish"]()
    b = world["store"].get(ea.key(ea.POINTER_KEY))
    doc = json.loads(b)
    doc["historical"]["sha256"] = "0" * 64
    with pytest.raises(ea.Refused) as e:
        ea.install(ea.encode_pointer(doc), world["store"], root=str(world["tmp"] / "r2"))
    assert e.value.reason == "FROZEN_BASE_MISMATCH"
    c = sqlite3.connect(world["live"])
    c.execute("UPDATE lineage SET value='proof' WHERE key='mode'")
    c.commit()
    c.close()
    with pytest.raises(ea.Refused) as e:
        world["publish"]()
    assert e.value.reason == "LIVE_LINEAGE_MISMATCH"


def test_a_missing_session_is_refused(world):
    world["append"](LIVE[0])
    st = ea._lc().Store(world["live"])
    with pytest.raises(ea._lc().Refused):                                       # the store itself refuses a skip
        st.commit_session(LIVE[2], LIVE[1], {})
    st.c.close()
    world["append"](LIVE[1])
    c = sqlite3.connect(world["live"])                                          # forge a gap past the store's guard
    c.execute("UPDATE live_session SET date='2026-09-29' WHERE date='2026-09-28'")
    for t in ea._lc().CONTENT_TABLES:
        c.execute(f"UPDATE {t} SET date='2026-09-29' WHERE date='2026-09-28'")
    c.commit()
    c.close()
    with pytest.raises(ea.Refused) as e:
        world["publish"]()
    assert e.value.reason == "LIVE_SESSIONS_NOT_CONTIGUOUS"


# ── fail closed / off ────────────────────────────────────────────────────────────────────────────
def test_off_is_byte_identical_and_in_force_without_authority_fails_closed(world, monkeypatch):
    monkeypatch.setenv("BREADTH_AUTHORITY_EXCH", "off")
    assert ea.universe_history("advancing", "nyse") is None and ea.token() == "" and not ea.serves("nyse")
    monkeypatch.setenv("BREADTH_AUTHORITY_EXCH", "v1")
    assert ea.universe_history("advancing", "nyse") == {}                       # never a fallback
    assert ea.token() == ":exch-unavailable" and not ea.serves("nyse")
    from api.services import breadth_daily_ohlc as bdo
    assert bdo.history("advancing", universe="nyse") == {}


# ── member surfaces follow the ONE seam ─────────────────────────────────────────────────────────
def test_library_registry_and_search_follow_the_authority(world, monkeypatch):
    from api.services import breadth_symbols as bs
    from api.services import breadth_universes as bu
    from api.services.market_indicators import registry as reg
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us,nyse,nasdaq")
    assert bu.published_universe_ids() == ["uct", "us"]                         # flag alone publishes nothing
    assert bs.resolve("NYSE:A50") is None and reg.resolve("NYSE:MCO") is None
    assert reg.get("NYSE:MCO").status == reg.ST_DORMANT
    for d in LIVE[:2]:
        world["append"](d)
    world["publish"]()
    world["sync"]()
    assert bu.published_universe_ids() == ["uct", "us", "nasdaq", "nyse"]
    for sym in ("NYSE:A50", "NASDAQ:A50", "NYSE:ADV", "NYSE:DEC", "NASDAQ:NH", "NYSE:NL"):
        assert bs.resolve(sym) is not None, sym
    assert bs.resolve("US:ADV") is None                                          # US keeps exactly the V1 set
    for alias, sid in (("NYMO", "NYSE:MCO"), ("$NYSI", "NYSE:MCS"), ("NYAD", "NYSE:AD"), ("NAMO", "NASDAQ:MCO"),
                       ("$NASI", "NASDAQ:MCS"), ("NAAD", "NASDAQ:AD"), ("nyse:mco", "NYSE:MCO")):
        r = reg.resolve(alias)
        assert r is not None and r.id == sid and r.status == reg.ST_PUBLISHED, alias
    pub = [s.id for s in reg.published_rows()]
    assert len(pub) == len(set(pub)) and {"NYSE:MCO", "NASDAQ:AD"} <= set(pub)
    syms = [r["symbol"] for r in bs.published_symbol_rows()]
    assert len(syms) == len(set(syms))                                           # no duplicate identities
    assert not set(syms) & set(pub)                                              # library ≠ indicators: one name each
    from api.services.market_indicators import producers
    producers._cache.clear() if hasattr(producers, "_cache") else None
    ds = producers.build("NYSE:MCO")
    assert ds is not None and dict(zip(ds.dates, ds.values)) == ea.derived("NYSE:MCO")
    monkeypatch.setenv("BREADTH_AUTHORITY_EXCH", "off")                          # kill switch: unpublished at once
    assert bu.published_universe_ids() == ["uct", "us"] and reg.resolve("NYMO") is None


def test_status_is_machine_readable(world):
    world["append"](LIVE[0])
    world["publish"]()
    world["sync"]()
    s = ea.status()
    for k in ("mode", "available", "publication_version", "latest_session", "session_count", "live_logical_sha256",
              "lineage", "frozen", "last_sync", "token", "pointer_sha256"):
        assert k in s
    assert s["available"] and s["latest_session"] == LIVE[0] and s["lineage"]["code_commit"] == "03a78ad30"
    assert s["lineage"]["publisher_code_commit"] == "cafe1234"


def test_library_availability_and_floor_come_from_the_authority(world, monkeypatch):
    from api.services import breadth_symbols as bs
    for d in LIVE[:2]:
        world["append"](d)
    world["publish"]()
    world["sync"]()
    bs._avail_cache.update(at=0.0, value=None)
    a = bs.availability()
    assert a["nasdaq"] == {"state": "available", "rows": len(_days("2026-09-01", "2026-09-28")),
                           "first": "2026-09-01", "last": "2026-09-28", "floor": "2026-09-01",
                           "authority": "exchange-breadth-v1"}
    assert a["nyse"]["first"] == "2026-09-08" and a["nyse"]["floor"] == "2026-09-08"
    rows = [r for r in bs.library_rows(["nyse"]) if r["metric"] == "advancing"]
    assert rows and rows[0]["floor"] == "2026-09-08" and rows[0]["symbol"] == "NYSE:ADV"
    monkeypatch.setenv("BREADTH_AUTHORITY_EXCH", "off")
    assert bs._exchange_availability("nyse") is None and bs.display_floor("nyse") is None


def test_an_installed_replica_is_DARK_while_the_member_flag_is_off(world, monkeypatch):
    """BREADTH_EXCH_SYNC_ENABLED only installs a verified replica. With BREADTH_AUTHORITY_EXCH unset, every
    member surface is byte-identical to before: no token, nothing served, nothing published, rows dormant."""
    from api.services import breadth_authority as ba
    from api.services import breadth_daily_ohlc as bdo
    from api.services import breadth_symbols as bs
    from api.services import breadth_universes as bu
    from api.services.market_indicators import registry as reg
    world["append"](LIVE[0])
    world["publish"]()
    monkeypatch.delenv("BREADTH_AUTHORITY_EXCH", raising=False)
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us")                  # production's current value
    tok_before = ba.token()
    assert world["sync"]()["result"] == "installed"                         # the replica IS installed
    assert ba.token() == tok_before and ea.token() == ""                    # cache keys / ETags unchanged
    assert ea.universe_history("advancing", "nyse") is None                 # readers take their old path
    assert bdo.history.__module__ and ea.derived("NYSE:MCO") is None
    assert bu.published_universe_ids() == ["uct", "us"]
    assert bs.resolve("NYSE:A50") is None and reg.resolve("NYMO") is None
    assert reg.get("NYSE:MCO").status == reg.ST_DORMANT
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us,nyse,nasdaq")       # even a premature flag publishes nothing
    assert bu.published_universe_ids() == ["uct", "us"]
