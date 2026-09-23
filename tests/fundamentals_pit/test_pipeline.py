"""Pipeline: bulk backfill (resume, idempotency, failures), incremental ingestion,
publish, snapshot-archive gate, provenance. No network: bulk archives and
SEC fetchers are synthetic."""
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from api.services.fundamentals_pit import backfill as BF, derive as D, incremental as INC
from api.services.fundamentals_pit import publish as P, snapshot_archive as SA, store as S

CIK = 1234567


def _cf(values):
    """companyfacts for one company: FY2023 revenue from a 10-K, 9M from a 10-Q."""
    rows = [{"start": s, "end": e, "val": v, "accn": a, "fy": 2023, "fp": "FY", "form": f, "filed": fd}
            for s, e, v, a, f, fd in values]
    return {"cik": CIK, "entityName": "TESTCO", "facts": {"us-gaap": {"Revenues": {"units": {"USD": rows}}}}}


def _sub(accns):
    return {"cik": str(CIK), "name": "TESTCO", "tickers": ["TST"], "fiscalYearEnd": "1231",
            "filings": {"recent": {
                "accessionNumber": [a for a, *_ in accns], "filingDate": [d for _, d, *_ in accns],
                "reportDate": ["" for _ in accns], "acceptanceDateTime": [t for _, _, t, _ in accns],
                "form": [f for *_, f in accns]}, "files": []}}


FACTS = [("2023-01-01", "2023-09-30", 330, "A-23-3", "10-Q", "2023-11-01"),
         ("2023-01-01", "2023-12-31", 460, "A-24-1", "10-K", "2024-02-15")]
ACCNS = [("A-23-3", "2023-11-01", "2023-11-01T20:00:00.000Z", "10-Q"),
         ("A-24-1", "2024-02-15", "2024-02-15T21:00:00.000Z", "10-K")]


def _zips(tmp: Path, facts=FACTS, accns=ACCNS):
    cf, sub = tmp / "companyfacts.zip", tmp / "submissions.zip"
    with zipfile.ZipFile(cf, "w") as z:
        z.writestr(f"CIK{CIK:010d}.json", json.dumps(_cf(facts)))
    with zipfile.ZipFile(sub, "w") as z:
        z.writestr(f"CIK{CIK:010d}.json", json.dumps(_sub(accns)))
    return str(cf), str(sub)


def _run(tmp, *extra, facts=FACTS, accns=ACCNS):
    cf, sub = _zips(tmp, facts, accns)
    return BF.run(["--db", str(tmp / "pit.db"), "--bulk-companyfacts", cf, "--bulk-submissions", sub,
                   "--tickers", "TST", "--workers", "1", *extra])


def test_bulk_backfill_ingests_derives_and_resumes(tmp_path):
    r1 = _run(tmp_path)
    assert (r1["ingested"], r1["failed"], r1["derived"]) == (1, [], 1)
    c = S.connect(str(tmp_path / "pit.db"))
    q = S.read_series(c, CIK, D.DERIVATION_VERSION, ["revenue_q"])["revenue_q"]
    assert [(v, pe) for _, v, pe, _ in q][-1] == (130, "2023-12-31")        # Q4 = FY - 9M
    r2 = _run(tmp_path)                                                    # resume: nothing to do
    assert (r2["ingested"], r2["skipped"], r2["derive_skipped"]) == (0, 1, 1)


def test_a_new_filing_is_appended_and_the_original_is_kept(tmp_path):
    _run(tmp_path)
    more = FACTS + [("2023-01-01", "2023-12-31", 470, "A-24-9", "10-K/A", "2024-05-01")]
    r = _run(tmp_path, facts=more, accns=ACCNS + [("A-24-9", "2024-05-01", "2024-05-01T14:00:00.000Z", "10-K/A")])
    assert r["facts_new"] == 1 and r["derived"] == 1
    c = S.connect(str(tmp_path / "pit.db"))
    assert sorted(v for (v,) in c.execute("SELECT val FROM fact")) == [330, 460, 470]


def test_a_broken_company_is_recorded_not_skipped(tmp_path):
    cf, sub = tmp_path / "companyfacts.zip", tmp_path / "submissions.zip"
    with zipfile.ZipFile(cf, "w") as z:
        z.writestr(f"CIK{CIK:010d}.json", "{not json")
    with zipfile.ZipFile(sub, "w") as z:
        z.writestr(f"CIK{CIK:010d}.json", json.dumps(_sub(ACCNS)))
    r = BF.run(["--db", str(tmp_path / "pit.db"), "--bulk-companyfacts", str(cf), "--bulk-submissions", str(sub),
                "--tickers", "TST", "--workers", "1"])
    assert len(r["failed"]) == 1 and r["ingested"] == 0


def test_incremental_refresh_is_pending_until_companyfacts_catches_up(tmp_path):
    db = str(tmp_path / "pit.db")
    c = S.connect(db)
    state = {"facts": FACTS[:1], "accns": ACCNS[:1]}
    fetch = lambda cik: (_cf(state["facts"]), _sub(state["accns"]), [_sub(state["accns"])["filings"]["recent"]])
    no_instance = lambda cik, accn: None
    INC.enqueue(c, [{"cik": CIK, "accn": "A-24-1", "form": "10-K"}], {CIK})
    r = INC.drain(c, fetch_company=fetch, fetch_instance=no_instance, local_root=str(tmp_path / "pub"),
                  sources=())
    assert r["retry"] == ["A-24-1"]                        # the 10-K is not in companyfacts yet
    state.update(facts=FACTS, accns=ACCNS)
    r = INC.drain(c, fetch_company=fetch, fetch_instance=no_instance, local_root=str(tmp_path / "pub"),
                  sources=())
    assert r["done"] == ["A-24-1"]
    assert (tmp_path / "pub" / "fundamentals_pit" / f"v{D.DERIVATION_VERSION}" / "cik" / f"{CIK}.json").exists()
    assert c.execute("SELECT count(*) FROM pending_refresh").fetchone()[0] == 0
    assert c.execute("SELECT count(*) FROM signal_check").fetchone()[0] == 2   # both periodic filings inspected


def test_publish_skips_an_unchanged_artifact(tmp_path):
    _run(tmp_path)
    c = S.connect(str(tmp_path / "pit.db"))
    a = P.publish_company(c, CIK, local_root=str(tmp_path / "pub"))
    b = P.publish_company(c, CIK, local_root=str(tmp_path / "pub"))
    assert a["published"] and not b["published"] and a["etag"] == b["etag"]
    doc = json.loads((tmp_path / "pub" / P.key_for(CIK)).read_text())
    assert doc["tickers"] == ["TST"] and "revenue_ttm" in doc["metrics"]


def test_provenance_rederives_the_served_value(tmp_path):
    _run(tmp_path)
    c = S.connect(str(tmp_path / "pit.db"))
    (t,) = c.execute("SELECT t_eff FROM series_point WHERE metric='revenue_q' ORDER BY t_eff DESC LIMIT 1").fetchone()
    e = D.explain(c, CIK, "revenue_q", t, sources=())
    assert e["matches_served"] and {f["accn"] for f in e["facts"]} == {"A-23-3", "A-24-1"}
    assert all(f["public_at"] for f in e["facts"])


def test_snapshot_archive_is_fail_closed(tmp_path):
    c = S.connect(str(tmp_path / "pit.db"))
    r = SA.capture(c, "2026-09-22", {"AAPL": {"pe_fwd": 30.1, "peg": 2.2}})
    assert r["written"] == 0 and set(r["blocked"]) == {m.id for m in SA.CANDIDATES}
    assert c.execute("SELECT count(*) FROM snapshot_capture").fetchone()[0] == 0


def test_snapshot_archive_writes_once_when_a_source_is_allowed(tmp_path, monkeypatch):
    c = S.connect(str(tmp_path / "pit.db"))
    monkeypatch.setattr(SA, "RETENTION_ALLOWED", frozenset({("fmp", "fundamentals")}))
    r1 = SA.capture(c, "2026-09-22", {"AAPL": {"peg": 2.2}})
    r2 = SA.capture(c, "2026-09-22", {"AAPL": {"peg": 9.9}})          # same day: append-only, no overwrite
    assert (r1["written"], r2["written"]) == (1, 0)
    assert c.execute("SELECT value FROM snapshot_capture").fetchone()[0] == 2.2


def test_edgar_current_feed_parses():
    atom = """<feed><entry><title>10-Q - APPLE INC (0000320193) (Filer)</title>
<link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/0000320193-26-000020-index.htm"/>
<updated>2026-07-31T06:01:02-04:00</updated></entry></feed>"""
    assert INC.parse_current_feed(atom) == [{"form": "10-Q", "cik": 320193, "accn": "0000320193-26-000020",
                                             "updated": "2026-07-31T06:01:02-04:00"}]


def test_bulk_inputs_quarters_and_resumable_download(tmp_path, monkeypatch):
    from api.services.fundamentals_pit import bulk_inputs as BI, sec_client as SEC
    assert BI.quarters("2025q3", "2026q2") == ["2025q3", "2025q4", "2026q1", "2026q2"]
    calls = []
    def fake_download(url, dest, **kw):
        calls.append(url)
        if url.endswith("2026q2.zip"):
            raise SEC.SecError(url, 404, "not found")         # not yet published: range ends
        open(dest, "wb").write(b"x")
        return 1
    monkeypatch.setattr(SEC, "download", fake_download)
    man = BI.fetch(str(tmp_path), "2025q4", "2026q3")
    assert [p.rsplit("/", 1)[-1].rsplit("\\", 1)[-1] for p in man["fs"]] == ["2025q4.zip", "2026q1.zip"]
    assert not any(u.endswith("2026q3.zip") for u in calls)   # stopped at the first 404


def test_download_keeps_an_existing_file_and_never_leaves_a_partial(tmp_path):
    import io
    from api.services.fundamentals_pit import sec_client as SEC
    dest = tmp_path / "a.zip"
    dest.write_bytes(b"kept")
    assert SEC.download("https://example.invalid/a.zip", str(dest)) == 0 and dest.read_bytes() == b"kept"
    class R(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): return False
    out = tmp_path / "b.zip"
    n = SEC.download("https://example.invalid/b.zip", str(out), opener=lambda req, timeout: R(b"abc" * 1000))
    assert n == 3000 and out.read_bytes() == b"abc" * 1000 and not (tmp_path / "b.zip.part").exists()


def test_massive_ledger_fails_loudly_on_truncation_or_silence(monkeypatch):
    import pytest
    from api.services.fundamentals_pit import split_ledger as SL
    monkeypatch.setattr(SL, "massive_rows", lambda lo, hi: [])
    with pytest.raises(SL.LedgerFetchError):
        SL.massive_rows_chunked("2020-01-01", "2021-06-30")
    monkeypatch.setattr(SL, "massive_rows", lambda lo, hi: [("X", lo, 2.0, "1->2")] * 19_500)
    with pytest.raises(SL.LedgerFetchError):
        SL.massive_rows_chunked("2020-01-01", "2020-12-31")
    monkeypatch.setattr(SL, "massive_rows", lambda lo, hi: [("X", lo, 2.0, "1->2")])
    assert len(SL.massive_rows_chunked("2020-03-01", "2022-02-01")) == 3


def test_backfill_never_logs_request_urls(tmp_path):
    """MEASURED: httpx logs every request URL at INFO and the Massive client puts
    apiKey= in the query string -- the first production run wrote the key to its
    job log. run() must silence the HTTP loggers before any request."""
    import logging
    from api.services.fundamentals_pit import backfill as B
    logging.getLogger("httpx").setLevel(logging.INFO)
    try:
        B.run(["--db", str(tmp_path / "x.db"), "--tickers", "X"])
    except SystemExit:
        pass                                   # no source given -> argparse error; the guard already ran
    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("httpcore").level >= logging.WARNING
