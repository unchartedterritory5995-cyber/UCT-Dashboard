"""V5 acceptance instant (EDGAR header, America/New_York) + acceptance-time correction + upstream-pending liveness.

Runs the REAL ingest / derive / validate / publish code against the synthetic frozen base of test_v5_cutover
(LocalTarget, no network). EDGAR headers come from a fake keyed by accession."""
import datetime as dt
import json

import pytest

from api.services.fundamentals_pit import publish as P, serving as SV
from api.services.fundamentals_pit import v5_acceptance as ACC, v5_discovery as DISC, v5_live as L, v5_pipeline as PL
from api.services.fundamentals_pit import v5_publish as PUB, v5_validate as VAL

from .test_v5_cutover import (ACCNS, CIK, FACTS, HDR, IDX, NOW, _batch, _fetch, _local_serving, _series,  # noqa: F401
                              env)

_REAL_HEADER = ACC.header_acceptance                  # captured before the fixture swaps in the fake
U = lambda s: int(dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp())


# ── the rule ───────────────────────────────────────────────────────────────────────────────────────────────
def test_eastern_daylight_acceptance_to_utc():
    assert ACC.eastern_to_utc("20260930163038") == (dt.datetime(2026, 9, 30, 20, 30, 38, tzinfo=dt.timezone.utc), "exact")


def test_eastern_standard_acceptance_to_utc():
    assert ACC.eastern_to_utc("20260115163038") == (dt.datetime(2026, 1, 15, 21, 30, 38, tzinfo=dt.timezone.utc), "exact")


def test_no_fixed_offset_every_day_follows_the_zone():
    seen = set()
    for d in range(366):
        day = dt.date(2026, 1, 1) + dt.timedelta(days=d)
        raw = day.strftime("%Y%m%d") + "120000"
        at, st = ACC.eastern_to_utc(raw)
        off = dt.datetime(day.year, day.month, day.day, 12, tzinfo=ACC.ET).utcoffset()
        assert st == "exact" and at.replace(tzinfo=None) - dt.datetime.strptime(raw, "%Y%m%d%H%M%S") == -off
        seen.add(-off)
    assert seen == {dt.timedelta(hours=4), dt.timedelta(hours=5)}


def test_dst_transitions_and_date_boundaries():
    e, Z = ACC.eastern_to_utc, dt.timezone.utc
    assert e("20260308015959") == (dt.datetime(2026, 3, 8, 6, 59, 59, tzinfo=Z), "exact")       # last EST second
    assert e("20260308030000") == (dt.datetime(2026, 3, 8, 7, 0, 0, tzinfo=Z), "exact")         # first EDT second
    gap = e("20260308023000")                                                                    # never existed
    assert gap[1] == "ambiguous_later" and gap[0] >= dt.datetime(2026, 3, 8, 7, 0, tzinfo=Z)
    assert e("20261101013000") == (dt.datetime(2026, 11, 1, 6, 30, tzinfo=Z), "ambiguous_later")  # twice: the LATER
    assert e("20261101030000") == (dt.datetime(2026, 11, 1, 8, 0, tzinfo=Z), "exact")
    assert e("20260930203000")[0] == dt.datetime(2026, 10, 1, 0, 30, tzinfo=Z)                  # UTC date moves
    assert e("20261231193000")[0] == dt.datetime(2027, 1, 1, 0, 30, tzinfo=Z)                   # UTC year moves
    assert e("20260101000500")[0] == dt.datetime(2026, 1, 1, 5, 5, tzinfo=Z)                    # Eastern midnight


def test_header_is_read_from_the_edgar_acceptance_record():
    body = b"<SEC-HEADER>0001104659-26-112354.hdr.sgml : 20260930\n<ACCEPTANCE-DATETIME>20260930163038\n<TYPE>10-Q\n"
    real = _REAL_HEADER
    assert real(23217, "0001104659-26-112354", get=lambda url: body) == (
        "20260930163038", dt.datetime(2026, 9, 30, 20, 30, 38, tzinfo=dt.timezone.utc), "exact")
    assert ACC.header_url(23217, "0001104659-26-112354").endswith(
        "/Archives/edgar/data/23217/000110465926112354/0001104659-26-112354.hdr.sgml")
    with pytest.raises(ACC.AcceptanceUnavailable):
        real(1, "0000000001-26-000001", get=lambda url: b"<SEC-HEADER>no acceptance line")

    def boom(url):
        raise RuntimeError("404")
    with pytest.raises(ACC.AcceptanceUnavailable):
        real(1, "0000000001-26-000001", get=boom)


def test_correction_guard_is_exact():
    parent = {"split_status": "verified", "withheld_split_sensitive": False,
              "metrics": {"revenue_ttm": [[10, 1.0, 20240331, "x"], [20, 2.0, 20240630, "x"]]}}
    ok = {**parent, "metrics": {"revenue_ttm": [[10, 1.0, 20240331, "x"], [25, 2.0, 20240630, "x"]]}}
    assert ACC.correction_guard(parent, ok, {20: 25}) == []
    assert ACC.correction_guard(parent, {**ok, "metrics": {"revenue_ttm": [[10, 1.0, 20240331, "x"], [25, 2.5, 20240630, "x"]]}}, {20: 25})
    assert ACC.correction_guard(parent, ok, {})                                         # an unexplained move
    assert ACC.correction_guard(parent, {**ok, "withheld_split_sensitive": True}, {20: 25})
    assert ACC.correction_guard(parent, {**ok, "split_status": "unverified"}, {20: 25})


# ── ingestion ──────────────────────────────────────────────────────────────────────────────────────────────
SAMEQ = ("2024-01-01", "2024-03-31", 120, "A-26-5", "10-Q", "2026-09-29")
SAME_ACC = ("A-26-5", "2026-09-29", "2026-09-29T12:30:38.000Z", "10-Q")   # SEC's filing-day form: Eastern clock + Z


def _filing(env, accn):
    live = L.connect_live(env["p"])
    try:
        return live.execute("SELECT accepted_at, public_at FROM filing WHERE accn=?", (accn,)).fetchone()
    finally:
        live.close()


def test_same_day_ingestion_takes_the_header_instant(env):
    HDR["A-26-5"] = "20260929123038"                                          # accepted 12:30:38 ET = 16:30:38Z
    rec = _batch(env, FACTS + [SAMEQ], ACCNS + [SAME_ACC], [{"accn": "A-26-5", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "PUBLISHED"
    assert _filing(env, "A-26-5") == (U("2026-09-29T16:30:38"), U("2026-09-29T16:30:38"))
    live = L.connect_live(env["p"])
    ev = live.execute("SELECT header_eastern, accepted_at, status, submissions_raw FROM v5_acceptance WHERE accn='A-26-5'").fetchone()
    live.close()
    assert ev == ("20260929123038", U("2026-09-29T16:30:38"), "exact", "2026-09-29T12:30:38.000Z")
    ts = [r[0] for r in _series(env["t"])]
    assert U("2026-09-29T16:30:38") in ts and U("2026-09-29T12:30:38") not in ts


def test_next_day_ingestion_agrees_with_the_header(env):
    acc = ("A-26-5", "2026-09-28", "2026-09-28T20:30:38.000Z", "10-Q")      # true UTC, as served the day after
    rec = _batch(env, FACTS + [SAMEQ[:5] + ("2026-09-28",)], ACCNS + [acc], [{"accn": "A-26-5", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "PUBLISHED" and _filing(env, "A-26-5")[0] == U("2026-09-28T20:30:38")


def test_standard_time_filing_moves_five_hours_not_four(env):
    HDR["A-26-1"] = "20260115163038"
    acc = ("A-26-1", "2026-01-15", "2026-01-15T16:30:38.000Z", "10-Q")
    q = ("2024-01-01", "2024-03-31", 120, "A-26-1", "10-Q", "2026-01-15")
    _batch(env, FACTS + [q], ACCNS + [acc], [{"accn": "A-26-1", "cik": CIK, "form": "10-Q"}])
    assert _filing(env, "A-26-1")[0] == U("2026-01-15T21:30:38")


def test_effective_time_never_precedes_acceptance(env):
    HDR["A-26-5"] = "20260929123038"
    _batch(env, FACTS + [SAMEQ], ACCNS + [SAME_ACC], [{"accn": "A-26-5", "cik": CIK, "form": "10-Q"}])
    live = L.connect_live(env["p"])
    acc = dict(live.execute("SELECT accn, accepted_at FROM filing WHERE cik=?", (CIK,)).fetchall())
    pts = live.execute("SELECT t_eff, sources FROM series_point WHERE cik=? AND derivation_version=5", (CIK,)).fetchall()
    live.close()
    assert all(acc[a] <= t for t, s in pts for a in s.split(",") if a)


def test_unavailable_header_fails_closed_and_is_retried(env):
    cur0 = PUB.read_current(env["t"])
    HDR["A-26-5"] = None
    rec = _batch(env, FACTS + [SAMEQ], ACCNS + [SAME_ACC], [{"accn": "A-26-5", "cik": CIK, "form": "10-Q"}])
    assert rec["acquisition"]["failed_n"] == 1 and PUB.read_current(env["t"]) == cur0
    assert _filing(env, "A-26-5") is None
    HDR["A-26-5"] = "20260929123038"
    assert _batch(env, FACTS + [SAMEQ], ACCNS + [SAME_ACC], [])["state"] == "PUBLISHED"
    assert _filing(env, "A-26-5")[0] == U("2026-09-29T16:30:38")


# ── correction of stored timestamps ────────────────────────────────────────────────────────────────────────
def _legacy_publish(env, monkeypatch):
    """A version published BEFORE the fix: the same-day submissions value was trusted (Eastern clock read as UTC)."""
    with monkeypatch.context() as m:
        m.setattr(ACC, "normalize_new_filings", lambda conn, cik, pages, accns, **kw: (pages, []))
        rec = _batch(env, FACTS + [SAMEQ], ACCNS + [SAME_ACC], [{"accn": "A-26-5", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "PUBLISHED" and _filing(env, "A-26-5")[0] == U("2026-09-29T12:30:38")
    HDR["A-26-5"] = "20260929123038"
    return rec["version"], [{"accn": "A-26-5", "cik": CIK, "cls": "affected", "stored_accepted_at": U("2026-09-29T12:30:38"),
                             "old_public_at": U("2026-09-29T12:30:38"), "header_eastern": "20260929123038",
                             "authoritative_accepted_at": U("2026-09-29T16:30:38")}]


def test_correction_is_a_new_immutable_version_with_unchanged_values(env, monkeypatch):
    v1, ev = _legacy_publish(env, monkeypatch)
    m1 = env["t"].get(PUB.version_key(v1))
    o1 = env["t"].get(PUB.obj_key(json.loads(m1)["companies"][str(CIK)]))
    before = _series(env["t"])
    rec = ACC.run_correction(env["t"], ev, reason="acceptance-time test", p=env["p"], now=NOW + 3600)
    assert rec["state"] == "PUBLISHED" and rec["version"].endswith("-c")
    assert env["t"].get(PUB.version_key(v1)) == m1                                      # old manifest untouched
    assert env["t"].get(PUB.obj_key(json.loads(m1)["companies"][str(CIK)])) == o1          # old object untouched
    man = PUB.read_manifest(env["t"], rec["version"])
    assert man["parent"] == v1 and man["kind"] == "correction" and man["correction"]["filings"] == 1
    SV.clear_cache()
    after = _series(env["t"])
    moved = {U("2026-09-29T12:30:38"): U("2026-09-29T16:30:38")}
    assert after == sorted(([moved.get(r[0], r[0])] + list(r[1:]) for r in before), key=lambda r: r[0])
    assert [r[1:] for r in after] == [r[1:] for r in before]                             # values / periods / methods
    live = L.connect_live(env["p"])
    corr = live.execute("SELECT old_accepted_at, new_accepted_at, old_public_at, new_public_at, header_eastern "
                        "FROM v5_acceptance_correction").fetchall()
    acc = dict(live.execute("SELECT accn, accepted_at FROM filing WHERE cik=?", (CIK,)).fetchall())
    pts = live.execute("SELECT t_eff, sources FROM series_point WHERE cik=? AND derivation_version=5", (CIK,)).fetchall()
    st = PL.currentness(live, env["t"], now=NOW + 3600)
    live.close()
    assert corr == [(U("2026-09-29T12:30:38"), U("2026-09-29T16:30:38"), U("2026-09-29T12:30:38"),
                     U("2026-09-29T16:30:38"), "20260929123038")]
    assert all(acc[a] <= t for t, s in pts for a in s.split(",") if a)                  # zero lookahead
    assert st["version"] == rec["version"] and st["state"] != "WITHHELD"


def test_correction_that_is_not_pure_reverts_byte_for_byte_and_publishes_nothing(env, monkeypatch):
    v1, ev = _legacy_publish(env, monkeypatch)
    live = L.connect_live(env["p"])
    rows0 = VAL.stored_rows(live, CIK)
    f0 = live.execute("SELECT * FROM filing WHERE accn='A-26-5'").fetchone()
    live.close()
    monkeypatch.setattr(ACC, "correction_guard", lambda parent, new, tmap: ["value changed"])
    rec = ACC.run_correction(env["t"], ev, reason="t", p=env["p"], now=NOW + 3600)
    assert rec["state"] == "FAILED" and PUB.read_current(env["t"])["version"] == v1
    live = L.connect_live(env["p"])
    assert VAL.stored_rows(live, CIK) == rows0 and live.execute("SELECT * FROM filing WHERE accn='A-26-5'").fetchone() == f0
    assert live.execute("SELECT count(*) FROM v5_acceptance_correction").fetchone()[0] == 0
    body, _ = P.encode(P.artifact(live, CIK, 5))
    live.close()
    assert PUB.sha(body) == PUB.read_manifest(env["t"], v1)["companies"][str(CIK)]


def test_correction_refuses_stale_or_irreproducible_evidence(env, monkeypatch):
    v1, ev = _legacy_publish(env, monkeypatch)
    stale = [dict(ev[0], stored_accepted_at=ev[0]["stored_accepted_at"] + 1)]
    rec = ACC.run_correction(env["t"], stale, reason="t", p=env["p"], now=NOW + 3600)
    assert rec["state"] == "FAILED" and rec["correction"]["problems_n"] == 1
    HDR["A-26-5"] = "20260929123039"                                          # the header no longer reproduces
    rec = ACC.run_correction(env["t"], ev, reason="t", p=env["p"], now=NOW + 3600)
    assert rec["state"] == "FAILED" and PUB.read_current(env["t"])["version"] == v1
    assert _filing(env, "A-26-5")[0] == U("2026-09-29T12:30:38")


def test_dry_run_publishes_nothing_and_leaves_live_untouched(env, monkeypatch):
    v1, ev = _legacy_publish(env, monkeypatch)
    rec = ACC.run_correction(env["t"], ev, reason="t", p=env["p"], now=NOW + 3600, publish=False)
    assert rec["state"] == "READY_TO_PUBLISH" and rec["candidate_manifest"]["kind"] == "correction"
    assert PUB.read_current(env["t"])["version"] == v1 and _filing(env, "A-26-5")[0] == U("2026-09-29T12:30:38")


# ── upstream-pending liveness ──────────────────────────────────────────────────────────────────────────────
DQ_ACC = ("A-26-7", "2026-09-26", "2026-09-26T20:00:00.000Z", "10-Q")      # ~70 h before NOW
DQ = ("2024-01-01", "2024-03-31", 120, "A-26-7", "10-Q", "2026-09-26")


def _q(env, accn):
    live = L.connect_live(env["p"])
    try:
        return live.execute("SELECT state, attempts FROM v5_queue WHERE accn=?", (accn,)).fetchone()
    finally:
        live.close()


def _daily(env, facts, accns, now, days=lambda d, **k: None):
    SV.clear_cache()
    return PL.run_batch("daily", target=env["t"], p=env["p"], now=now, days_fn=days, fetch_company=_fetch(facts, accns),
                        fetch_instance=lambda c, a: None, sync_split=False)


def test_missing_companyfacts_past_the_hot_window_is_upstream_pending(env):
    rec = _batch(env, FACTS, ACCNS + [DQ_ACC], [{"accn": "A-26-7", "cik": CIK, "form": "10-Q"}])
    assert rec["acquisition"]["outcomes"] == {PL.DEFERRED: 1} and _q(env, "A-26-7") == (PL.DEFERRED, 1)


def test_upstream_pending_is_rechecked_at_a_bounded_cadence_and_resumes_when_facts_appear(env):
    _batch(env, FACTS, ACCNS + [DQ_ACC], [{"accn": "A-26-7", "cik": CIK, "form": "10-Q"}])
    r = _batch(env, FACTS + [DQ], ACCNS + [DQ_ACC], [])                         # a non-daily batch never rechecks
    assert r["state"] == "NO_CHANGE" and _q(env, "A-26-7") == (PL.DEFERRED, 1)
    r = _daily(env, FACTS + [DQ], ACCNS + [DQ_ACC], NOW + 3600)                 # not due yet
    assert r["upstream_recheck"] == [] and _q(env, "A-26-7") == (PL.DEFERRED, 1)
    r = _daily(env, FACTS + [DQ], ACCNS + [DQ_ACC], NOW + PL.DEFER_RECHECK_S + 60)
    assert r["upstream_recheck"] == ["A-26-7"] and r["state"] == "PUBLISHED" and _q(env, "A-26-7")[0] == "ARRIVED"


def test_no_retry_storm_one_recheck_per_window(env):
    _batch(env, FACTS, ACCNS + [DQ_ACC], [{"accn": "A-26-7", "cik": CIK, "form": "10-Q"}])
    t = NOW + PL.DEFER_RECHECK_S + 60
    for k in range(4):
        _daily(env, FACTS, ACCNS + [DQ_ACC], t + 600 * k)
    assert _q(env, "A-26-7") == (PL.DEFERRED, 2)


def test_upstream_pending_is_terminal_only_after_the_deferral_window(env):
    old = ("A-26-8", "2026-05-01", "2026-05-01T20:00:00.000Z", "10-Q")
    rec = _batch(env, FACTS, ACCNS + [old], [{"accn": "A-26-8", "cik": CIK, "form": "10-Q"}])
    assert rec["acquisition"]["outcomes"] == {"FAILED": 1} and _q(env, "A-26-8")[0] == "FAILED"


def test_legacy_upstream_failure_migrates_and_true_failures_stay_terminal(env):
    live = L.connect_live(env["p"])
    with live:
        live.execute("INSERT INTO v5_queue VALUES ('K-1', ?, '10-K', 'sweep', 0, '2026-09-28', 'FAILED', 11, ?, NULL, 0)",
                     (CIK, PL._LEGACY_UPSTREAM_FAILED))
        live.execute("INSERT INTO v5_queue VALUES ('K-2', ?, '10-K', 'sweep', 0, '2026-09-28', 'FAILED', 3, 'malformed', NULL, 0)",
                     (CIK,))
    live.close()
    assert _batch(env, FACTS, ACCNS, [])["upstream_migrated"] == ["K-1"]
    assert _q(env, "K-1")[0] == PL.DEFERRED and _q(env, "K-2")[0] == "FAILED"
    assert _batch(env, FACTS, ACCNS, [])["upstream_migrated"] == []


def test_upstream_pending_never_advances_verified_through_and_currentness_says_so(env):
    a = ("0001234567-26-000077", "2026-09-28", "2026-09-28T20:00:00.000Z", "10-Q")
    live = L.connect_live(env["p"]); L.meta_set(live, "daily_index_verified_through", "2026-09-25"); live.close()
    later = NOW + 2 * 86400
    day = dt.date(2026, 9, 28)
    rec = _daily(env, FACTS, ACCNS + [a], later, days=lambda d, **k: DISC.parse_form_index(IDX) if d == day else None)
    assert _q(env, a[0])[0] == PL.DEFERRED and rec["horizon"]["daily_index_verified_through"] == "2026-09-25"
    live = L.connect_live(env["p"])
    st = PL.currentness(live, env["t"], now=later)
    live.close()
    assert st["state"] == "STALE" and any("upstream pending" in r and a[0] in r for r in st["reasons"])


def test_a_correction_killed_before_publishing_is_completed_by_a_rerun(env, monkeypatch):
    v1, ev = _legacy_publish(env, monkeypatch)
    with monkeypatch.context() as m:
        def killed(*a, **k):
            raise SystemExit("worker redeployed")
        m.setattr(PUB, "publish_version", killed)
        with pytest.raises(SystemExit):
            ACC.run_correction(env["t"], ev, reason="t", p=env["p"], now=NOW + 3600)
    # a kill is not an exception the batch can catch: the rows stay rewritten, nothing is published
    assert PUB.read_current(env["t"])["version"] == v1 and _filing(env, "A-26-5")[0] == U("2026-09-29T16:30:38")
    rec = ACC.run_correction(env["t"], ev, reason="t", p=env["p"], now=NOW + 7200)
    assert rec["state"] == "PUBLISHED" and PUB.read_current(env["t"])["version"] == rec["version"]
    SV.clear_cache()
    assert U("2026-09-29T16:30:38") in [r[0] for r in _series(env["t"])]


def test_an_old_header_without_the_stamp_falls_back_to_the_filing_index_only():
    pages = {".hdr.sgml": b"<SEC-HEADER>0000950159-97-000194.hdr.sgml : 19970512\n<TYPE>10-Q\n",
             "-index.htm": b'<div class="infoHead">Accepted</div>\n<div class="info">1997-05-12 14:03:11</div>'}
    get = lambda url: next(v for k, v in pages.items() if url.endswith(k))
    assert _REAL_HEADER(1, "0000950159-97-000194", get=get) == (
        "19970512140311", dt.datetime(1997, 5, 12, 18, 3, 11, tzinfo=dt.timezone.utc), "exact")    # EDT in May 1997
    both = {".hdr.sgml": b"<ACCEPTANCE-DATETIME>20260115163038", "-index.htm": b'Accepted</div><div class="info">1999-01-01 00:00:00'}
    assert _REAL_HEADER(1, "x", get=lambda url: next(v for k, v in both.items() if url.endswith(k)))[0] == "20260115163038"
