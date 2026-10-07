"""acquire.reference_from_massive: parallel pull = the same bytes as a serial pull, resumable, fails closed on errors."""
import gzip
import io
import json
import urllib.error

import pytest

from api.services.marketcap import acquire as Q

TICKERS = [f"T{i:03d}" for i in range(40)]


def _universe(tmp_path):
    p = tmp_path / "u.json.gz"
    p.write_bytes(gzip.compress(json.dumps({str(i): ["", [t]] for i, t in enumerate(TICKERS)}).encode()))
    return str(p)


def _fake(fail=()):
    def urlopen(url, timeout=30):
        path = url.split("apiKey=")[0]
        t = next((x for x in TICKERS if f"/{x}?" in path or f"ticker={x}&" in path or f"FIGI{x}/" in path), None)
        if t in fail:
            raise urllib.error.HTTPError(url, 500, "boom", {}, None)
        if "/v3/reference/tickers/" in path:
            body = {"results": {"ticker": t, "composite_figi": f"FIGI{t}", "cik": "1", "share_class_shares_outstanding": 7}}
        elif "/splits" in path:
            body = {"results": [{"execution_date": "2020-01-02", "split_from": 1, "split_to": 2}]}
        else:
            body = {"results": {"events": [{"type": "ticker_change", "date": "2019-01-01", "ticker_change": {"ticker": t}}]}}
        return io.BytesIO(json.dumps(body).encode())
    return urlopen


def test_parallel_equals_serial_bytes_and_resumes(tmp_path, monkeypatch):
    monkeypatch.setattr(Q.time, "sleep", lambda s: None)
    monkeypatch.setattr(Q.urllib.request, "urlopen", _fake())
    u = _universe(tmp_path)
    a, b = tmp_path / "a.jsonl", tmp_path / "b.jsonl"
    Q.reference_from_massive(u, str(a), key="k", workers=1)
    r = Q.reference_from_massive(u, str(b), key="k", workers=8)
    assert r["tickers"] == 40 and a.read_bytes() == b.read_bytes()
    lines = b.read_text().splitlines()
    assert [json.loads(x)[0] for x in lines] == sorted(TICKERS)
    # resume: a partial file is completed, nothing is pulled twice, the bytes are the same
    c = tmp_path / "c.jsonl"
    c.write_text("\n".join(reversed(lines[:10])) + "\n")
    r = Q.reference_from_massive(u, str(c), key="k", workers=4)
    assert r == {"tickers_pulled": 30, "already": 10, "tickers": 40} and c.read_bytes() == a.read_bytes()


def test_request_errors_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(Q.time, "sleep", lambda s: None)
    monkeypatch.setattr(Q.urllib.request, "urlopen", _fake(fail={"T007"}))
    with pytest.raises(Q.AcquisitionError, match="failed"):
        Q.reference_from_massive(_universe(tmp_path), str(tmp_path / "r.jsonl"), key="k", workers=4)
    got = [json.loads(x)[0] for x in (tmp_path / "r.jsonl").read_text().splitlines()]
    assert "T007" not in got and len(got) == 39                  # the failed ticker is not recorded as done
    monkeypatch.setattr(Q.urllib.request, "urlopen", _fake())
    r = Q.reference_from_massive(_universe(tmp_path), str(tmp_path / "r.jsonl"), key="k", workers=4)
    assert r["tickers_pulled"] == 1 and r["tickers"] == 40


def test_an_invalid_ticker_400_is_a_definitive_not_found(tmp_path, monkeypatch):
    monkeypatch.setattr(Q.time, "sleep", lambda s: None)

    def urlopen(url, timeout=30):
        if "/v3/reference/tickers/T003" in url:
            raise urllib.error.HTTPError(url, 400, "Invalid ticker", {}, None)
        return _fake()(url, timeout)
    monkeypatch.setattr(Q.urllib.request, "urlopen", urlopen)
    r = Q.reference_from_massive(_universe(tmp_path), str(tmp_path / "r.jsonl"), key="k", workers=4)
    assert r["tickers"] == 40
    row = next(json.loads(x) for x in (tmp_path / "r.jsonl").read_text().splitlines() if json.loads(x)[0] == "T003")
    assert row[1]["ticker"] is None and row[1]["cik"] is None          # recorded, details null (as in M3's reference)
