"""V5 cutover: frozen base + live store + versioned publication + validation + serving seam + rollback.

Everything runs the REAL ingest / evidence / derive / publish code on a synthetic company against a LOCAL bucket
(LocalTarget). No network, no R2."""
import datetime as dt
import json
import os
import shutil
import sqlite3

import pytest

from api.services.fundamentals_pit import derive as D, publish as P, serving as SV, store as S
from api.services.fundamentals_pit import v5_discovery as DISC, v5_live as L, v5_ops as OPS, v5_pipeline as PL
from api.services.fundamentals_pit import v5_prod as VP, v5_publish as PUB, v5_validate as VAL, incremental as INC
from api.services.fundamentals_pit import v5_acceptance as ACC

CIK = 1234567


def _cf(rows):
    return {"cik": CIK, "entityName": "TESTCO", "facts": {"us-gaap": {"Revenues": {"units": {"USD": [
        {"start": s, "end": e, "val": v, "accn": a, "fy": 2023, "fp": "FY", "form": f, "filed": fd}
        for s, e, v, a, f, fd in rows]}}}}}


# EDGAR filing headers (<ACCEPTANCE-DATETIME>, Eastern wall clock). By default a filing's header states the instant its
# submissions row gives in UTC (SEC's day-after form); HDR overrides it per accession (None = header unavailable).
REG: dict = {}
HDR: dict = {}


def _fake_header(cik, accn, get=None):
    raw = HDR[accn] if accn in HDR else (
        dt.datetime.fromisoformat(REG[accn].replace("Z", "+00:00")).astimezone(ACC.ET).strftime("%Y%m%d%H%M%S")
        if accn in REG else None)
    if raw is None:
        raise ACC.AcceptanceUnavailable(f"{accn}: header unavailable (test)")
    return (raw, *ACC.eastern_to_utc(raw))


def _sub(accns):
    for a, _, t, _ in accns:
        REG.setdefault(a, t)
    return {"cik": str(CIK), "name": "TESTCO", "tickers": ["TST"], "fiscalYearEnd": "1231",
            "filings": {"recent": {
                "accessionNumber": [a for a, *_ in accns], "filingDate": [d for _, d, *_ in accns],
                "reportDate": ["" for _ in accns], "acceptanceDateTime": [t for _, _, t, _ in accns],
                "form": [f for *_, f in accns]}, "files": []}}


FACTS = [("2022-01-01", "2022-12-31", 400, "A-23-1", "10-K", "2023-02-15"),
         ("2023-01-01", "2023-03-31", 100, "A-23-2", "10-Q", "2023-05-01"),
         ("2023-01-01", "2023-06-30", 210, "A-23-3", "10-Q", "2023-08-01"),
         ("2023-01-01", "2023-09-30", 330, "A-23-4", "10-Q", "2023-11-01"),
         ("2023-01-01", "2023-12-31", 460, "A-24-1", "10-K", "2024-02-15")]
ACCNS = [("A-23-1", "2023-02-15", "2023-02-15T21:00:00.000Z", "10-K"),
         ("A-23-2", "2023-05-01", "2023-05-01T20:00:00.000Z", "10-Q"),
         ("A-23-3", "2023-08-01", "2023-08-01T20:00:00.000Z", "10-Q"),
         ("A-23-4", "2023-11-01", "2023-11-01T20:00:00.000Z", "10-Q"),
         ("A-24-1", "2024-02-15", "2024-02-15T21:00:00.000Z", "10-K")]
NOW = dt.datetime(2026, 9, 29, 18, 0, tzinfo=dt.timezone.utc).timestamp()


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A 'frozen base' (ingested + V5-derived synthetic company), installed like production, plus a local bucket."""
    from api.services.fundamentals_pit import sec_client as SEC
    monkeypatch.setattr(SEC, "filing_instance", lambda cik, accn: None)
    monkeypatch.setattr(ACC, "header_acceptance", _fake_header)
    REG.clear(); HDR.clear()
    build = tmp_path / "build.db"
    c = S.connect(str(build))
    INC_ingest(c, FACTS, ACCNS)
    D.build_company(c, CIK, version=5, sources=())
    c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    c.close()
    p = VP.paths(str(tmp_path / "prod"))
    os.makedirs(p["base_artifacts"])
    shutil.copyfile(build, p["base_db"])
    c = sqlite3.connect(f"file:{p['base_db']}?mode=ro", uri=True)
    body, _ = P.encode(P.artifact(c, CIK, 5))
    c.close()
    open(os.path.join(p["base_artifacts"], f"{CIK}.json"), "wb").write(body)
    json.dump({"artifacts": {str(CIK): {"sha256": PUB.sha(body)}}}, open(os.path.join(p["base_artifacts"], "manifest.json"), "w"))
    monkeypatch.setattr(VP, "FROZEN_SHA256", VP.sha256_file(p["base_db"]))
    monkeypatch.setattr(VP, "FROZEN_BYTES", os.path.getsize(p["base_db"]))
    monkeypatch.setattr("api.services.fundamentals_pit.split_ledger.PRODUCTION_SOURCES", ())
    monkeypatch.setattr(D, "PRODUCTION_SOURCES", ())
    monkeypatch.setattr(PL, "PRODUCTION_SOURCES", ())
    L.init_live(p)
    t = PUB.LocalTarget(str(tmp_path / "bucket"))
    OPS.publish_base(t, p)
    return {"p": p, "t": t, "tmp": tmp_path, "base_sha": VP.FROZEN_SHA256}


def INC_ingest(c, facts, accns):
    from api.services.fundamentals_pit import ingest as I
    sub = _sub(accns)
    I.ingest_company(c, CIK, _cf(facts), sub, [sub["filings"]["recent"]])
    INC.check_signals(c, CIK, fetch_instance=lambda cik, accn: None)


def _fetch(facts, accns):
    return lambda cik: (_cf(facts), _sub(accns), [_sub(accns)["filings"]["recent"]])


def _series(t, symbol="TST", metric="revenue_ttm"):
    src = SV.v5_source()
    return SV.series_response(symbol, [metric], source=src)[1]["metrics"][metric]


@pytest.fixture(autouse=True)
def _local_serving(env, monkeypatch):
    monkeypatch.setenv("FUNDAMENTALS_PIT_SOURCE", "local")
    monkeypatch.setenv("FUNDAMENTALS_PIT_ARTIFACT_DIR", str(env["tmp"] / "bucket"))
    monkeypatch.delenv("FUNDAMENTALS_PIT_SERVE", raising=False)
    SV.clear_cache()
    yield
    SV.clear_cache()


def _batch(env, facts, accns, entries, now=NOW, **kw):
    SV.clear_cache()
    return PL.run_batch("replay", target=env["t"], p=env["p"], now=now, entries=entries,
                        fetch_company=_fetch(facts, accns), fetch_instance=lambda cik, accn: None, sync_split=False, **kw)


NEWQ = ("2024-01-01", "2024-03-31", 120, "A-24-2", "10-Q", "2024-05-01")
NEWQ_ACCN = ("A-24-2", "2024-05-01", "2024-05-01T20:00:00.000Z", "10-Q")


# ── identity ────────────────────────────────────────────────────────────────
def test_methodology_is_byte_identical_to_the_frozen_base():
    assert VP.methodology_drift() == {}


def test_base_version_is_the_frozen_artifact_byte_for_byte(env):
    cur = PUB.read_current(env["t"])
    assert cur["version"] == VP.BASE_VERSION_ID and cur["previous"] is None
    man = PUB.read_manifest(env["t"], cur["version"], verify_sha=cur["manifest_sha256"])
    body = open(os.path.join(env["p"]["base_artifacts"], f"{CIK}.json"), "rb").read()
    assert man["companies"] == {str(CIK): PUB.sha(body)} and man["tickers"] == {"TST": CIK}
    assert env["t"].get(PUB.obj_key(PUB.sha(body))) == body


def test_init_live_refuses_twice_and_the_base_is_never_written(env):
    with pytest.raises(L.LiveError):
        L.init_live(env["p"])
    assert L.verify_base(env["p"])["sha256"] == env["base_sha"]


# ── new filing / amendment / restatement ────────────────────────────────────
def test_new_filing_publishes_a_new_version_and_history_is_unchanged(env):
    before = _series(env["t"])
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "PUBLISHED" and rec["validation"]["changed"] == 1
    after = _series(env["t"])
    b = rec["horizon"]  # the new filing is the latest
    assert b["latest_filing"]["accn"] == "A-24-2"
    boundary = int(dt.datetime(2024, 5, 1, 20, tzinfo=dt.timezone.utc).timestamp())
    assert [r for r in after if r[0] < boundary] == [r for r in before if r[0] < boundary]
    assert after[-1][2] == "2024-03-31" and after[-1][1] == 480                 # TTM Q1-24 = 460 - 100 + 120
    cur = PUB.read_current(env["t"])
    assert cur["previous"] == VP.BASE_VERSION_ID and cur["version"] == rec["version"]
    assert L.verify_base(env["p"])["sha256"] == env["base_sha"]


def test_amendment_changes_the_interpretation_from_its_own_time_only(env):
    before = _series(env["t"])
    amend = ("2023-01-01", "2023-12-31", 470, "A-24-9", "10-K/A", "2024-06-01")
    amend_accn = ("A-24-9", "2024-06-01", "2024-06-01T14:00:00.000Z", "10-K/A")
    rec = _batch(env, FACTS + [amend], ACCNS + [amend_accn], [{"accn": "A-24-9", "cik": CIK, "form": "10-K/A"}])
    assert rec["state"] == "PUBLISHED"
    after = _series(env["t"])
    t_amend = int(dt.datetime(2024, 6, 1, 14, tzinfo=dt.timezone.utc).timestamp())
    assert [r for r in after if r[0] < t_amend] == [r for r in before if r[0] < t_amend]     # no retroactive fiction
    assert [r for r in after if r[0] >= t_amend][0][1] == 470                           # FY2023 restated at the 10-K/A


def test_restatement_evidence_withholds_from_its_own_time(env, monkeypatch):
    """A new 10-Q whose own instance flags FY2023 as restated: V5 must stop serving the pre-restatement basis AT that
    filing, and nothing before it may move."""
    before = _series(env["t"])
    monkeypatch.setattr(INC, "instance_evidence", lambda cik, accn, fetch_instance=None:
                        [(accn, "us-gaap:Revenues", "2023-01-01", "2023-12-31", "restatement_axis")] if accn == "A-24-2" else [])
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "PUBLISHED"
    after = _series(env["t"])
    t = int(dt.datetime(2024, 5, 1, 20, tzinfo=dt.timezone.utc).timestamp())
    assert [r for r in after if r[0] < t] == [r for r in before if r[0] < t]
    live = L.connect_live(env["p"])
    assert live.execute("SELECT count(*) FROM filing_signal WHERE accn='A-24-2'").fetchone()[0] == 1
    live.close()
    newest = [r for r in after if r[0] >= t][0]
    assert newest[3] == "gap" or newest[1] != 480                           # the restated basis is not mixed in


def test_filing_without_financial_facts_is_terminal_and_publishes_nothing(env):
    eightk = ("0000000000-26-000001", "2026-09-28", "2026-09-28T12:00:00.000Z", "8-K")
    rec = _batch(env, FACTS, ACCNS + [eightk], [{"accn": eightk[0], "cik": CIK, "form": "8-K"}])
    assert rec["state"] == "NO_CHANGE" and rec["acquisition"]["outcomes"] == {"NO_FINANCIAL_FACTS": 1}
    assert PUB.read_current(env["t"])["version"] == VP.BASE_VERSION_ID


def test_periodic_filing_not_yet_in_companyfacts_is_retried_not_dropped(env):
    q = ("2024-01-01", "2024-03-31", 120, "A-26-9", "10-Q", "2026-09-29")
    qa = ("A-26-9", "2026-09-29", "2026-09-29T12:00:00.000Z", "10-Q")      # six hours before NOW
    rec = _batch(env, FACTS, ACCNS + [qa], [{"accn": "A-26-9", "cik": CIK, "form": "10-Q"}])
    assert rec["acquisition"]["outcomes"] == {"RETRY": 1}
    live = L.connect_live(env["p"])
    assert live.execute("SELECT state FROM v5_queue WHERE accn='A-26-9'").fetchone()[0] == "QUEUED"
    live.close()
    rec2 = _batch(env, FACTS + [q], ACCNS + [qa], [])
    assert rec2["state"] == "PUBLISHED" and rec2["acquisition"]["outcomes"] == {"ARRIVED": 1}


def test_periodic_filing_without_facts_after_48h_is_failed_visibly(env):
    rec = _batch(env, FACTS, ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["acquisition"]["outcomes"] == {"FAILED": 1}


def test_filing_cited_only_by_unretained_tags_is_no_financial_facts(env):
    """MEASURED in the catch-up rehearsal: 39 S-1/F-1/F-3/S-4 filings cited only by tags V5 does not retain sat in
    RETRY forever and blocked the daily horizon. Ingest never stores them (same as the full rebuild)."""
    s1 = ("0000000000-26-000009", "2026-09-28", "2026-09-28T12:00:00.000Z", "S-1")
    cf = _cf(FACTS)
    cf["facts"]["dei"] = {"EntityPublicFloat": {"units": {"USD": [
        {"end": "2026-06-30", "val": 1, "accn": s1[0], "fy": 2026, "fp": "FY", "form": "S-1", "filed": "2026-09-28"}]}}}
    SV.clear_cache()
    rec = PL.run_batch("replay", target=env["t"], p=env["p"], now=NOW, entries=[{"accn": s1[0], "cik": CIK, "form": "S-1"}],
                       fetch_company=lambda c: (cf, _sub(ACCNS + [s1]), [_sub(ACCNS + [s1])["filings"]["recent"]]),
                       fetch_instance=lambda c, a: None, sync_split=False)
    assert rec["acquisition"]["outcomes"] == {"NO_FINANCIAL_FACTS": 1}


# ── validation gates ────────────────────────────────────────────────────────
def test_unexplained_retroactive_change_quarantines_the_company_and_keeps_the_parent(env, monkeypatch):
    cur0 = PUB.read_current(env["t"])
    real = VAL.pit_guard
    monkeypatch.setattr(VAL, "pit_guard", lambda parent, new, boundary, split_changed, **kw:
                        {**real(parent, new, boundary, split_changed=split_changed, **kw), "retro_unexplained": ["revenue_ttm"]})
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "NO_CHANGE" and rec["validation"]["quarantined"] == [CIK]
    assert PUB.read_current(env["t"]) == cur0                                 # members never see it
    live = L.connect_live(env["p"])
    assert live.execute("SELECT cik FROM v5_quarantine").fetchall() == [(CIK,)]
    assert live.execute("SELECT boundary FROM v5_pending WHERE cik=?", (CIK,)).fetchone()[0] is not None
    live.close()


def test_batch_level_failure_is_withheld_and_the_pointer_does_not_move(env, monkeypatch):
    cur0 = PUB.read_current(env["t"])
    monkeypatch.setattr(P, "ticker_index", lambda conn: {})
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "WITHHELD" and PUB.read_current(env["t"]) == cur0


def test_a_crash_before_the_pointer_leaves_members_on_the_old_version(env, monkeypatch):
    cur0 = PUB.read_current(env["t"])
    real_put = env["t"].put
    def put(key, body, ct="application/json"):
        if key == PUB.CURRENT_KEY:
            raise RuntimeError("killed")
        real_put(key, body, ct)
    monkeypatch.setattr(env["t"], "put", put)
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "FAILED" and PUB.read_current(env["t"]) == cur0
    monkeypatch.setattr(env["t"], "put", real_put)
    # resumes from pending; same result. A retry is a later batch (its own clock -> its own version id): reusing
    # the crashed batch's id would make the write-once manifest check depend on whether the wall clock ticked.
    rec2 = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [], now=NOW + 60)
    assert rec2["state"] == "PUBLISHED"


def test_incremental_equals_a_full_rebuild_of_the_same_horizon(env, tmp_path):
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "PUBLISHED"
    served = SV.v5_source().artifact_for(CIK)
    full = S.connect(str(tmp_path / "full.db"))
    INC_ingest(full, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN])
    D.build_company(full, CIK, version=5, sources=())
    rebuilt = P.artifact(full, CIK, 5)
    assert rebuilt["metrics"] == served["metrics"]


def test_pit_guard_allows_split_sensitive_history_only_with_a_split_change():
    parent = {"metrics": {"eps_diluted_ttm": [[1, 2.0, 20200331, "fiscal_year"]], "revenue_ttm": [[1, 5.0, 20200331, "x"]]}}
    new = {"metrics": {"eps_diluted_ttm": [[1, 1.0, 20200331, "fiscal_year"]], "revenue_ttm": [[1, 5.0, 20200331, "x"]]}}
    assert VAL.pit_guard(parent, new, 10, split_changed=True)["retro_unexplained"] == []
    assert VAL.pit_guard(parent, new, 10, split_changed=False)["retro_unexplained"] == ["eps_diluted_ttm"]
    new2 = {"metrics": {**new["metrics"], "revenue_ttm": [[1, 6.0, 20200331, "x"]]}}
    assert VAL.pit_guard(parent, new2, 10, split_changed=True)["retro_unexplained"] == ["revenue_ttm"]


def _wh_parent(withheld):
    return {"withheld_split_sensitive": withheld, "metrics": {"eps_diluted_ttm": [[1, 1.0, "2020-03-31", "x"], [2, 1.1, "2020-06-30", "x"]],
                                                            "revenue_ttm": [[1, 5.0, "2020-03-31", "x"]]}}


def test_withholding_triggered_by_a_new_filing_is_explained_with_its_evidence(monkeypatch):
    monkeypatch.setattr(S, "build_info", lambda c, cik, v: {"detail": {"split_verification": {"status": "unverified",
        "reasons": [["window_disagrees", "2026-05-01", "2026-09-28", 3, 1.0, 2.0]]}}})
    b = int(dt.datetime(2026, 9, 28, 20, tzinfo=dt.timezone.utc).timestamp())
    w = VAL.classify_withholding(None, 1, _wh_parent(False), {"withheld_split_sensitive": True, "metrics": {}}, b, False, ["A-1"])
    assert w["classification"] == "EXPLAINED" and w["direction"] == "withheld"
    assert w["triggering_filings"] == ["A-1"] and w["affected_metric_families"] == ["eps_diluted_ttm"]
    assert w["previously_served_points_removed"] == 2 and w["findings_from_new_filings"]


def test_withholding_with_no_new_evidence_is_unexplained_and_quarantines(monkeypatch):
    monkeypatch.setattr(S, "build_info", lambda c, cik, v: {"detail": {"split_verification": {"status": "unverified",
        "reasons": [["window_disagrees", "2019-01-01", "2020-01-01", 3, 1.0, 2.0]]}}})
    b = int(dt.datetime(2026, 9, 28, 20, tzinfo=dt.timezone.utc).timestamp())
    w = VAL.classify_withholding(None, 1, _wh_parent(False), {"withheld_split_sensitive": True, "metrics": {}}, b, False, ["A-1"])
    assert w["classification"] == "UNEXPLAINED"
    assert VAL.classify_withholding(None, 1, _wh_parent(False), {"withheld_split_sensitive": True, "metrics": {}}, b, True, [])["classification"] == "EXPLAINED"
    assert VAL.classify_withholding(None, 1, _wh_parent(True), {"withheld_split_sensitive": True, "metrics": {}}, b, False, []) is None


def test_withholding_anomaly_threshold_is_the_poisson_tail_of_the_measured_rate():
    assert [PL.withholding_anomaly_threshold(d) for d in (1, 5, 7)] == [4, 7, 8]


def test_a_withholding_cluster_holds_the_batch(env, monkeypatch):
    cur0 = PUB.read_current(env["t"])
    real = VAL.validate_company
    def fake(conn, cik, **kw):
        r = real(conn, cik, **kw)
        r["withholding"] = {"cik": cik, "direction": "withheld", "classification": "EXPLAINED", "triggering_filings": [],
                            "affected_metric_families": [], "previously_served_points_removed": 0}
        return r
    monkeypatch.setattr(VAL, "validate_company", fake)
    monkeypatch.setattr(PL, "withholding_anomaly_threshold", lambda span: 1)
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    assert rec["state"] == "WITHHELD" and "withholding anomaly" in rec["validation"]["batch_errors"][0]
    assert PUB.read_current(env["t"]) == cur0


def test_a_ledger_that_loses_split_rows_is_never_an_explanation():
    """MEASURED 2026-09-30: SEC dropped old tickers (PHGE, BTOG, RAY) from three companies' submissions; the ledger
    (keyed by current tickers) lost genuine reverse splits and per-share history re-based / was withheld."""
    parent = {"withheld_split_sensitive": False, "metrics": {"eps_diluted_ttm": [[1, -10.0, "2020-03-31", "x"]]}}
    new = {"withheld_split_sensitive": False, "metrics": {"eps_diluted_ttm": [[1, -1.0, "2020-03-31", "x"]]}}
    assert VAL.pit_guard(parent, new, 10, split_changed=True, ledger_lost=0)["retro_unexplained"] == []
    assert VAL.pit_guard(parent, new, 10, split_changed=True, ledger_lost=2)["retro_unexplained"] == ["eps_diluted_ttm"]


def test_withholding_from_lost_ledger_rows_is_unexplained(monkeypatch):
    monkeypatch.setattr(S, "build_info", lambda c, cik, v: {"detail": {"split_verification": {"status": "unverified",
        "reasons": [["window_disagrees", "2023-11-14", "2024-11-14", 2, 1.0, 0.1]]}}})
    w = VAL.classify_withholding(None, 1, _wh_parent(False), {"withheld_split_sensitive": True, "metrics": {}}, None, True, [],
                                 ledger_gained=0, ledger_lost=2)
    assert w["classification"] == "UNEXPLAINED" and w["split_ledger_rows_lost"] == 2


def test_no_new_filing_means_no_history_may_change():
    parent = {"metrics": {"revenue_ttm": [[1, 5.0, "2020-03-31", "x"]]}}
    new = {"metrics": {"revenue_ttm": [[1, 6.0, "2020-03-31", "x"]]}}
    assert VAL.pit_guard(parent, new, None, split_changed=False)["retro_unexplained"] == ["revenue_ttm"]


def test_quarantine_restores_a_company_from_an_earlier_version(env):
    rec = _batch(env, FACTS + [NEWQ], ACCNS + [NEWQ_ACCN], [{"accn": "A-24-2", "cik": CIK, "form": "10-Q"}])
    base = PUB.read_manifest(env["t"], VP.BASE_VERSION_ID)
    r = OPS.quarantine_companies(env["t"], [CIK], VP.BASE_VERSION_ID, "test", env["p"])
    cur = PUB.read_current(env["t"])
    man = PUB.read_manifest(env["t"], cur["version"], verify_sha=cur["manifest_sha256"])
    assert cur["previous"] == rec["version"] and man["companies"][str(CIK)] == base["companies"][str(CIK)]
    assert man["kind"] == "quarantine" and man["quarantined"] == [CIK]
    live = L.connect_live(env["p"])
    assert live.execute("SELECT cik FROM v5_quarantine").fetchall() == [(CIK,)]
    live.close()


def test_split_sync_never_stores_a_future_split_and_purges_old_ones(env):
    live = L.connect_live(env["p"])
    live.execute("INSERT INTO split_event VALUES ('TST','2026-10-20',0.1,'massive',NULL,1)"); live.commit()
    asked = []
    def rows(lo, hi):
        asked.append(hi)
        return [("TST", "2026-09-28", 2.0, None), ("TST", "2026-10-05", 3.0, None)]
    r = PL.sync_splits(live, now=NOW, rows_fn=rows)
    got = live.execute("SELECT ex_date, ratio FROM split_event WHERE ticker='TST' ORDER BY ex_date").fetchall()
    live.close()
    assert asked == ["2026-09-29"] and r["purged_future_rows"] == 1 and got == [("2026-09-28", 2.0)]


def test_a_new_split_reaches_derivation_through_the_stale_scan(env):
    live = L.connect_live(env["p"])
    live.execute("INSERT INTO split_event VALUES ('TST','2026-09-28',2.0,'massive',NULL,1)"); live.commit()
    live.close()
    SV.clear_cache()
    rec = PL.run_batch("daily", target=env["t"], p=env["p"], now=NOW, days_fn=lambda d, **k: None,
                       fetch_company=_fetch(FACTS, ACCNS), fetch_instance=lambda c, a: None, sync_split=False)
    assert rec["stale_scan"]["added_to_pending"] == [CIK] and rec["stale_scan"]["detail"][str(CIK)]["gained"] == 1
    assert rec["state"] == "PUBLISHED" and rec["validation"]["quarantined"] == []


# ── serving seam + rollback ─────────────────────────────────────────────────
def test_serving_defaults_to_v4_and_follows_the_control_object(env):
    SV.clear_cache()
    assert SV.selection() == {"serve": "v4", "pin": None, "by": "default"}
    PUB.write_serving(env["t"], "v5", by="t", reason="t")
    SV.clear_cache()
    src = SV.current_source()
    assert src.kind == "v5" and src.version_id == VP.BASE_VERSION_ID
    os.environ["FUNDAMENTALS_PIT_SERVE"] = "v4"
    try:
        assert SV.current_source().kind == "v4"
    finally:
        del os.environ["FUNDAMENTALS_PIT_SERVE"]


def test_a_v5_selection_without_a_pointer_fails_safe_to_v4(tmp_path, monkeypatch):
    t = PUB.LocalTarget(str(tmp_path / "empty"))
    t.put(PUB.SERVING_KEY, PUB.encode({"serve": "v5", "v5_pin": None}))
    monkeypatch.setenv("FUNDAMENTALS_PIT_ARTIFACT_DIR", str(tmp_path / "empty"))
    SV.clear_cache()
    src = SV.current_source()
    assert src.kind == "v4" and src.fallback_reason


def test_refuses_to_select_v5_without_a_pointer(tmp_path):
    with pytest.raises(PUB.PublishError):
        PUB.write_serving(PUB.LocalTarget(str(tmp_path / "x")), "v5", by="t", reason="t")


def test_rollback_drill(tmp_path):
    r = OPS.rollback_drill(str(tmp_path / "drill"))
    assert r["ok"] and r["objects_intact"], r


def test_publication_is_write_once_and_compare_and_set(tmp_path):
    t = PUB.LocalTarget(str(tmp_path / "b"))
    a = PUB.encode({"x": 1})
    m = PUB.build_manifest(version_id="v1", parent=None, companies={1: PUB.sha(a)}, tickers={}, fields={})
    PUB.publish_version(t, m, {PUB.sha(a): a}, expect_parent=None)
    with pytest.raises(PUB.PublishError):                              # pointer moved (someone published v1)
        PUB.publish_version(t, dict(m, version="v2"), {}, expect_parent=None)
    with pytest.raises(PUB.PublishError):                              # same id, different content
        PUB.publish_version(t, dict(m, parent="zz"), {}, expect_parent="v1")
    with pytest.raises(PUB.PublishError):                              # references a missing object
        PUB.publish_version(t, PUB.build_manifest(version_id="v3", parent="v1", companies={1: "0" * 64}, tickers={}, fields={}),
                            {}, expect_parent="v1")
    assert PUB.read_current(t)["version"] == "v1"


def test_v4_payload_and_etag_are_unchanged_by_the_seam(tmp_path, monkeypatch):
    doc = {"v": 1, "cik": 9, "tickers": ["ZZ"], "name": "Z", "derivation_version": 4, "input_hash": "h", "built_at": 1,
           "split_status": "verified", "withheld_split_sensitive": False, "metrics": {"revenue_ttm": [[5, 1.0, "2020-03-31", "direct"]]}}
    t = PUB.LocalTarget(str(tmp_path / "v4"))
    t.put(P.key_for(9, 4), P.encode(doc)[0])
    t.put(P.index_key(4), P.encode({"v": 1, "derivation_version": 4, "tickers": {"ZZ": 9}})[0])
    monkeypatch.setenv("FUNDAMENTALS_PIT_ARTIFACT_DIR", str(tmp_path / "v4"))
    SV.clear_cache()
    st, body, etag = SV.series_response("ZZ", ["revenue_ttm"])
    import hashlib
    want = '"' + hashlib.sha256(json.dumps(["h", ["revenue_ttm"], {"revenue_ttm": [5, 1.0, "2020-03-31", "direct"]}],
                                          default=str).encode()).hexdigest()[:32] + '"'
    assert st == 200 and etag == want and "version" not in body and body["derivation_version"] == 4


# ── discovery / currentness ─────────────────────────────────────────────────
IDX = """Description:           Daily Index of EDGAR Dissemination Feed by Form Type
Last Data Received:    September 28, 2026

Form Type   Company Name                                                  CIK         Date Filed  File Name
---------------------------------------------------------------------------------------------------------------------------------------------
10-Q        TESTCO                                                        1234567     20260928    edgar/data/1234567/0001234567-26-000077.txt
DEF 14A     OTHERCO                                                       7654321     20260928    edgar/data/7654321/0007654321-26-000001.txt
"""


def test_daily_form_index_parses_forms_with_spaces():
    rows = DISC.parse_form_index(IDX)
    assert rows == [{"form": "10-Q", "cik": 1234567, "filed": "20260928", "accn": "0001234567-26-000077"},
                    {"form": "DEF 14A", "cik": 7654321, "filed": "20260928", "accn": "0007654321-26-000001"}]


def test_daily_batch_verifies_a_day_only_when_its_filings_are_terminal(env):
    day = dt.date(2026, 9, 28)
    fetch = _fetch(FACTS + [NEWQ], ACCNS + [("0001234567-26-000077", "2026-09-28", "2026-09-28T20:00:00.000Z", "10-Q")])
    live = L.connect_live(env["p"]); L.meta_set(live, "daily_index_verified_through", "2026-09-25"); live.close()
    days = lambda d, **k: DISC.parse_form_index(IDX) if d == day else None
    rec = PL.run_batch("daily", target=env["t"], p=env["p"], now=NOW, days_fn=days, fetch_company=fetch,
                       fetch_instance=lambda c, a: None, sync_split=False)
    assert rec["discovery"]["daily"][0][0] == "2026-09-28"
    live = L.connect_live(env["p"])
    st = live.execute("SELECT state FROM v5_queue WHERE accn='0001234567-26-000077'").fetchone()[0]
    vt = L.meta_get(live, "daily_index_verified_through")
    live.close()
    assert st == "QUEUED" and vt == "2026-09-25"                  # the 10-Q's facts are not in companyfacts yet
    assert rec["horizon"]["daily_index_verified_through"] == "2026-09-25"


def test_hold_parks_every_batch(env):
    open(env["p"]["hold"], "w").write("x")
    assert PL.run_batch("cycle", target=env["t"], p=env["p"])["state"] == "HOLD"


def test_the_lease_admits_one_writer(env):
    a = L.Lease(env["p"])
    assert a.acquire()
    try:
        assert PL.run_batch("cycle", target=env["t"], p=env["p"])["state"] == "BUSY"
    finally:
        a.release()


def test_provenance_explain_reproduces_the_served_value(env):
    from api.services.fundamentals_pit import provenance as PV
    live = L.connect_live(env["p"])
    (t,) = live.execute("SELECT max(t_eff) FROM series_point WHERE cik=? AND metric='revenue_ttm' AND derivation_version=5",
                        (CIK,)).fetchone()
    e = PV.explain(live, CIK, "revenue_ttm", t)
    live.close()
    assert e["matches_served"] and e["facts"]
