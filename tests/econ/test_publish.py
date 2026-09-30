"""publish.py -- the wire payload, placement, the vintages artifact, idempotent publish.

The seeded store (`seed`) is shared by test_serving / test_router:
  USCPI     July: first seen T1 (320.0), REVISED at T2 (320.5); Aug first seen T2 (321.0)
            series_state + a bls:cpi calendar event
  USCPIYOY  derived rows (release kind derived)
  USNFP     a provider-stated NA period (value None) -- kept, never dropped
  USRETAILXA DISABLED member with stored rows (must never be served)
  USGOODSBAL UNVERIFIED, USUMCSENT EXCLUDED/RED -- stored rows, never served
"""
from __future__ import annotations

import copy
import gzip
import json

import pytest

from api.services.econ import publish as P
from api.services.econ import registry as R
from api.services.econ import store as S

T1 = 1786537800          # 2026-08-12 12:30Z (July CPI)
T2 = 1789043400          # 2026-09-10 12:30Z (Aug CPI + July revision)
DAY = 86400
NOW = T2 + 5 * DAY


def _row(ps, pe, v, t, pit="V", method="scheduled", inputs=None):
    return (ps, pe, v, "", t, method, pit, None, inputs)


def seed_store(path: str) -> str:
    s = S.connect(path)
    try:
        r1 = s.upsert_release("bls:cpi:2026-07", "bls:cpi", "live", T1)
        r2 = s.upsert_release("bls:cpi:2026-08", "bls:cpi", "live", T2)
        s.write_observations("USCPI", r1, [_row("2026-07-01", "2026-07-31", 320.0, T1)])
        s.write_observations("USCPI", r2, [_row("2026-07-01", "2026-07-31", 320.5, T2),
                                           _row("2026-08-01", "2026-08-31", 321.0, T2)])
        rd = s.upsert_release(f"derived:USCPIYOY@1:{T2}", "bls:cpi", "derived", T2)
        s.write_observations("USCPIYOY", rd, [
            _row("2026-07-01", "2026-07-31", 2.9, T2, pit="L", method="derived:yoy_pct@1"),
            _row("2026-08-01", "2026-08-31", 3.0, T2, pit="L", method="derived:yoy_pct@1")])
        rn = s.upsert_release("bls:empsit:2025-10", "bls:empsit", "live", T1)
        s.write_observations("USNFP", rn, [_row("2025-09-01", "2025-09-30", 159000.0, T1 - 40 * DAY),
                                           _row("2025-10-01", "2025-10-31", None, T1)])
        for sym in ("USRETAILXA", "USGOODSBAL", "USUMCSENT"):
            rx = s.upsert_release(f"x:{sym}", "x", "live", T1)
            s.write_observations(sym, rx, [_row("2026-07-01", "2026-07-31", 123.0, T1)])
        s.put_state("USCPI", state="CURRENT", latest_period="2026-08-01", expected_period="2026-08-01",
                    last_success_at=T2 + 60, latest_available_at=T2)
        s.put_state("USRETAILXA", state="CURRENT", latest_period="2026-07-01", last_success_at=T2)
        s.put_event("bls:cpi", "2026-09", "2026-10-15", sched_time="08:30", precision="exact",
                    source="authoritative_page", provenance="https://www.bls.gov/schedule/", fetched_at=T1)
    finally:
        s.close()
    return path


@pytest.fixture
def store(tmp_path):
    p = seed_store(str(tmp_path / "econ.db"))
    s = S.connect(p)
    yield s
    s.close()


# ── placement contract (shared with test_router / test_serving) ─────────────

def assert_first_availability_placement(points, expected: dict):
    """expected = {period_start: (t_first_available, value)} -- the contract: a
    point sits at its period's FIRST availability, carrying its latest(-as-of) value."""
    got = {p[2]: (p[0], p[1]) for p in points}
    assert got == expected, f"placement/value mismatch: {got} != {expected}"
    assert [(p[0], p[3]) for p in points] == sorted((p[0], p[3]) for p in points), "not sorted by (t, pe)"


LATEST = {"2026-07-01": (T1, 320.5), "2026-08-01": (T2, 321.0)}
ASOF_T1 = {"2026-07-01": (T1, 320.0)}


def test_latest_view_places_at_first_availability_with_latest_value(store):
    body = P.build_series_payload(store, "USCPI", now=NOW)
    assert body["view"] == "latest" and body["asof"] is None
    assert body["id"] == "ECON:USCPI" and body["symbol"] == "USCPI"
    assert body["columns"] == ["t", "v", "ps", "pe", "pit"]
    assert_first_availability_placement(body["points"], LATEST)
    assert body["points"][0] == [T1, 320.5, "2026-07-01", "2026-07-31", "V"]


def test_asof_view_returns_the_earlier_vintage(store):
    body = P.build_series_payload(store, "ECON:USCPI", asof=T1 + 1, now=NOW)
    assert body["view"] == "asof" and body["asof"] == T1 + 1
    assert_first_availability_placement(body["points"], ASOF_T1)
    assert all(p[0] <= T1 + 1 for p in body["points"])


def test_negative_control_period_end_placement_is_caught(store, monkeypatch):
    """⛔ If placement regresses to period_end (or the revision time), the checker fails."""
    real = P.points_from_store

    def at_period_end(*a, **k):
        from api.services.econ.timeutil import et_to_utc
        return [[et_to_utc(p[3], "00:00"), p[1], p[2], p[3], p[4]] for p in real(*a, **k)]

    monkeypatch.setattr(P, "points_from_store", at_period_end)
    body = P.build_series_payload(store, "USCPI", now=NOW)
    with pytest.raises(AssertionError):
        assert_first_availability_placement(body["points"], LATEST)


def test_na_period_is_kept_as_null(store):
    pts = P.build_series_payload(store, "USNFP", now=NOW)["points"]
    assert [p[1] for p in pts] == [159000.0, None]


def test_start_end_filter_period_start(store):
    pts = P.build_series_payload(store, "USCPI", start="2026-08-01", now=NOW)["points"]
    assert [p[2] for p in pts] == ["2026-08-01"]
    pts = P.build_series_payload(store, "USCPI", end="2026-07-31", now=NOW)["points"]
    assert [p[2] for p in pts] == ["2026-07-01"]


def test_currentness_from_state_and_next_calendar_event(store):
    cur = P.build_series_payload(store, "USCPI", now=NOW)["currentness"]
    assert cur == {"state": "CURRENT", "latest_period": "2026-08-01", "expected_period": "2026-08-01",
                   "next_release": {"date": "2026-10-15", "time": "08:30", "tz": "America/New_York",
                                    "precision": "exact"}}
    # no state row: never claims CURRENT
    cur = P.build_series_payload(store, "USCPIYOY", now=NOW)["currentness"]
    assert cur["state"] == "NO_EXPECTATION" and cur["latest_period"] == "2026-08-01"
    cur = P.build_series_payload(store, "USUNRATE", now=NOW)["currentness"]
    assert cur["state"] == "UNINITIALIZED"


@pytest.mark.parametrize("sym", ["USRETAILXA", "USGOODSBAL", "USUMCSENT", "USNOPE", "AAPL", "", "ECON:"])
def test_non_servable_symbols_build_nothing(store, sym):
    with pytest.raises(P.NotServable):
        P.build_series_payload(store, sym, now=NOW)


def test_servable_rechecks_licensing_and_role():
    base = copy.deepcopy(R.get("USCPI"))
    assert P.servable(base)[0]
    red = copy.deepcopy(base); red["licensing"]["class"] = "RED"
    sup = copy.deepcopy(base); sup["role"] = "support"
    fred = copy.deepcopy(base); fred["source"]["official_url"] = "https://fred.stlouisfed.org/series/CPIAUCSL"
    unv = copy.deepcopy(base); unv["source"]["verified"] = False
    yel = copy.deepcopy(base); yel["licensing"]["class"] = "YELLOW"
    for bad in (red, sup, fred, unv, yel):
        assert not P.servable(bad)[0]


# ── meta is a whitelist ─────────────────────────────────────────────────────

META_KEYS = {"symbol", "id", "name", "short_name", "description", "category", "subcategory", "frequency",
             "week_anchor", "units", "seasonal_adjustment", "presentation", "source", "derivation",
             "aliases", "synonyms", "history_start", "max_age_days"}
SOURCE_KEYS = {"agency", "dataset", "provider_series_id", "official_url", "attribution_key", "line"}
PAYLOAD_KEYS = {"id", "symbol", "view", "asof", "meta", "currentness", "columns", "points"}
FORBIDDEN = ("params", "licensing", "clearance", "approval_ref", "catalog_row", "fred_equivalent",
             "verified_evidence", "adapter", "api_key", "registrationkey", "UserID", "redistribution_note",
             "lag_rule", "CPIAUCSL")


def assert_no_internals(doc):
    text = json.dumps(doc)
    for f in FORBIDDEN:
        assert f not in text, f"{f!r} leaked into a member payload"


def test_payload_keys_are_whitelisted(store):
    body = P.build_series_payload(store, "USCPIYOY", now=NOW)
    assert set(body) == PAYLOAD_KEYS
    assert set(body["meta"]) == META_KEYS
    assert set(body["meta"]["source"]) <= SOURCE_KEYS | {"attribution_keys"}
    assert set(body["meta"]["units"]) == {"display", "fmt", "scale"}
    assert body["meta"]["derivation"] == {"op": "yoy_pct", "inputs": ["USCPINSA"]}
    assert set(body["currentness"]) == {"state", "latest_period", "expected_period", "next_release"}
    assert_no_internals(body)


def test_catalog_lists_only_servable_members_with_notices():
    cat = P.catalog_payload()
    syms = {r["symbol"] for r in cat["series"]}
    assert syms == {e["symbol"] for e in R.load_registry() if P.servable(e)[0]}
    assert "USCPI" in syms and "USRETAILXA" not in syms and "USUMCSENT" not in syms
    assert len(syms) == 136          # 42 cohort + 94 launch series (readiness 2026-09-30)
    assert "bls" in cat["attributions"] and "cannot vouch" in cat["attributions"]["bls"]["text"]
    for r in cat["series"]:
        assert set(r) <= META_KEYS | {"max_age_days"}
    assert_no_internals(cat)


# ── vintages artifact: parity with the store ────────────────────────────────

@pytest.mark.parametrize("asof", [None, T1 - 1, T1, T1 + 1, T2 - 1, T2, NOW])
@pytest.mark.parametrize("start,end", [(None, None), ("2026-08-01", None), (None, "2026-07-01")])
def test_vintages_artifact_answers_asof_exactly_like_the_store(store, asof, start, end):
    rows = P.build_vintages_payload(store, "USCPI")["rows"]
    assert len(rows) == 3                                  # both July vintages kept
    assert P.points_from_vintages(rows, asof, start, end) == P.points_from_store(store, "USCPI", asof, start, end)


# ── status: dates and states, never values ──────────────────────────────────

def test_status_has_no_values(store):
    st = P.status_payload(store, now=NOW)
    text = json.dumps(st)
    for v in ("320.5", "321.0", "320.0", "159000", "123.0"):
        assert v not in text
    row = next(r for r in st["series"] if r["symbol"] == "USCPI")
    assert set(row) == {"symbol", "state", "latest_period", "expected_period", "next_release", "last_success_at"}
    assert "USRETAILXA" not in {r["symbol"] for r in st["series"]}
    assert st["service"]["last_success_at"] == T2 + 60


# ── publish: artifacts, content addressing, idempotence ─────────────────────

def test_publish_writes_artifacts_and_is_idempotent(store, tmp_path):
    root = str(tmp_path / "art")
    P.clear_memo()
    r = P.publish_series(store, "USCPI", local_root=root, r2=False, now=NOW)
    assert r["published"] and r["series"]["written"] and r["vintages"]["written"]
    raw = open(tmp_path / "art" / "econ" / "v1" / "series" / "USCPI.json.gz", "rb").read()
    doc = json.loads(gzip.decompress(raw))
    assert doc == P.build_series_payload(store, "USCPI", now=NOW)
    assert r["series"]["etag"] == P.etag_of(P.canonical_json(doc))
    again = P.publish_series(store, "USCPI", local_root=root, r2=False, now=NOW)
    assert not again["published"] and again["series"]["unchanged"]
    # a fresh process (memo cleared) still sees the object is identical
    P.clear_memo()
    third = P.publish_series(store, "USCPI", local_root=root, r2=False, now=NOW)
    assert not third["published"]
    # new content -> rewritten
    rid = store.upsert_release("bls:cpi:2026-09", "bls:cpi", "live", T2 + 30 * DAY)
    store.write_observations("USCPI", rid, [_row("2026-09-01", "2026-09-30", 322.0, T2 + 30 * DAY)])
    assert P.publish_series(store, "USCPI", local_root=root, r2=False, now=NOW)["published"]


def test_publish_refuses_non_servable_and_empty(store, tmp_path):
    root = str(tmp_path / "art")
    assert not P.publish_series(store, "USRETAILXA", local_root=root, r2=False)["published"]
    assert not P.publish_series(store, "USUNRATE", local_root=root, r2=False)["published"]   # no data
    assert not (tmp_path / "art").exists()


def test_publish_all_and_r2_target(store, tmp_path, monkeypatch):
    puts = {}
    from api.services import data_sync
    monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: puts.__setitem__(k, (b, ct)) or True)
    monkeypatch.setattr(data_sync, "get_bytes", lambda k: puts.get(k, (None,))[0])
    P.clear_memo()
    res = P.publish_all(store, local_root=str(tmp_path / "art"), r2=True, now=NOW)
    assert set(puts) >= {"econ/v1/series/USCPI.json.gz", "econ/v1/vintages/USCPI.json.gz",
                         "econ/v1/catalog.json", "econ/v1/status.json"}
    assert "econ/v1/series/USRETAILXA.json.gz" not in puts
    assert puts["econ/v1/series/USCPI.json.gz"][1] == "application/gzip"
    assert res["series"]["USUNRATE"]["published"] is False
    n = len(puts)
    P.clear_memo()
    P.publish_all(store, r2=True, local_root=None, now=NOW)
    assert len(puts) == n


def test_r2_is_dry_unless_flag(monkeypatch):
    monkeypatch.delenv("ECON_PUBLISH_R2", raising=False)
    assert P.r2_enabled() is False


def test_a_failed_target_write_raises_so_ingest_keeps_it_pending(store, monkeypatch):
    from api.services import data_sync
    monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: False)
    monkeypatch.setattr(data_sync, "get_bytes", lambda k: None)
    P.clear_memo()
    with pytest.raises(P.PublishFailed):
        P.publish_series(store, "USCPI", local_root="", r2=True, now=NOW)


# ── next_release: first FUTURE event, series_state pointer preferred ───────

def test_next_release_prefers_state_pointer_and_skips_passed_events(tmp_path):
    from api.services.econ.timeutil import et_to_utc
    s = S.connect(str(tmp_path / "nr.db"))
    try:
        entry = {"symbol": "USEFFR", "release": {"calendar_key": "nyfed:effr"}}
        # a daily event at 09:00 ET TODAY that has already passed, then tomorrow's
        passed = s.put_event("nyfed:effr", "2026-09-28", "2026-09-29", sched_time="09:00", precision="rule",
                             source="rule")
        tomorrow = s.put_event("nyfed:effr", "2026-09-29", "2026-09-30", sched_time="09:00", precision="rule",
                               source="rule")
        now = et_to_utc("2026-09-29", "15:00")
        # the old date-granular lookup returned the passed event
        assert s.next_event("nyfed:effr", "2026-09-29")["event_id"] == passed
        # no state row: calendar fallback, but only a FUTURE event
        assert P.next_release(s, entry, now) == {"date": "2026-09-30", "time": "09:00",
                                                  "tz": "America/New_York", "precision": "rule"}
        # the state pointer wins (currentness filtered the grid; e.g. a later event)
        later = s.put_event("nyfed:effr", "2026-09-30", "2026-10-01", sched_time="09:00", precision="rule",
                            source="rule")
        s.put_state("USEFFR", state="CURRENT", next_event_id=later)
        assert P.next_release(s, entry, now)["date"] == "2026-10-01"
        # a stale pointer (event already passed) falls back to the first future event
        s.put_state("USEFFR", next_event_id=passed)
        assert P.next_release(s, entry, now)["date"] == "2026-09-30"
        # a superseded pointer is ignored
        s.put_state("USEFFR", next_event_id=tomorrow)
        s.delete_event(tomorrow, at=int(now))
        assert P.next_release(s, entry, now)["date"] == "2026-10-01"
        # nothing in the future -> null
        assert P.next_release(s, entry, et_to_utc("2026-10-02", "12:00")) is None
    finally:
        s.close()


def test_next_release_hole_is_unknown_with_no_date(tmp_path):
    s = S.connect(str(tmp_path / "hole.db"))
    try:
        entry = {"symbol": "USMTSDEF", "release": {"calendar_key": "fiscal:mts"}}
        hole = s.put_event("fiscal:mts", "2026-10", "2026-11-10", precision="unknown", source="authoritative_feed")
        s.put_state("USMTSDEF", state="NO_EXPECTATION", next_event_id=hole)
        from api.services.econ.timeutil import et_to_utc
        nr = P.next_release(s, entry, et_to_utc("2026-10-20", "12:00"))
        assert nr == {"date": None, "time": None, "tz": "America/New_York", "precision": "unknown"}
    finally:
        s.close()


# ── staleness: meta.max_age_days, measured from availability ──────────────────

@pytest.mark.parametrize("sym,want", [("USCPI", 45), ("USFHFAHPI", 45), ("USRGDPQA", 120), ("USICSA", 13),
                                      ("UST10Y2Y", 10), ("USEFFR", 10)])
def test_meta_max_age_days_by_frequency(sym, want):
    assert P.meta_for(R.get(sym))["max_age_days"] == want


def test_meta_max_age_days_override_and_unlimited():
    e = copy.deepcopy(R.get("USCPI"))
    e["presentation"]["max_age_days"] = 90
    assert P.meta_for(e)["max_age_days"] == 90
    e["presentation"]["max_age_days"] = None                    # explicit unlimited
    assert P.meta_for(e)["max_age_days"] is None
    irr = copy.deepcopy(R.get("USCPI")); irr["frequency"] = "IRREG"
    assert P.meta_for(irr)["max_age_days"] is None
    # negative control: the old 75-days-from-period-end default is gone for monthly
    assert P.meta_for(R.get("USCPI"))["max_age_days"] != 75


def test_monthly_max_age_covers_every_normal_release_interval_negative_control():
    """FHFA: ~60 d after period end, released monthly. From AVAILABILITY a 45 d limit spans
    each release interval (<= 35 d); from PERIOD END 75 d does not (60 + 31 > 75)."""
    ma = P.meta_for(R.get("USFHFAHPI"))["max_age_days"]
    intervals = [28, 35, 31]                                       # consecutive last-Tuesday releases
    assert all(i <= ma for i in intervals)
    assert any(60 + i > 75 for i in intervals)                      # the old rule blanked these
