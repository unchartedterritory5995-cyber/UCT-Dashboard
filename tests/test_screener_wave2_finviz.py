"""Wave 2 Task 3: finviz_universe — _parse shapes, run_pull, read_finviz_fields.

No sockets anywhere: every run_pull test monkeypatches
`_fetch_finviz_csv_text`; every reader test only touches a JSON file under
`tmp_path` via `SCREENER_FINVIZ_ARTIFACT`.
"""
import json
from datetime import datetime, timedelta, timezone

FULL_HEADERS = [
    "Ticker", "Shares Outstanding", "Shares Float", "Float %",
    "Short Float", "Short Ratio", "Insider Ownership",
    "Institutional Ownership",
]


def _csv(headers, rows):
    lines = [",".join(headers)]
    for r in rows:
        lines.append(",".join(str(x) for x in r))
    return "\n".join(lines) + "\n"


def _full_row(ticker):
    return [ticker, "1.50B", "1.20B", "80.00%", "3.45%", "2.1", "0.50%", "85.30%"]


def _make_full_csv(n=1005):
    return _csv(FULL_HEADERS, [_full_row(f"T{i:04d}") for i in range(n)])


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ── _parse shapes ────────────────────────────────────────────────────────

def test_parse_suffixed_absolutes():
    from api.services.screener import finviz_universe as fv
    assert fv._parse("1.5B", False) == 1.5e9
    assert fv._parse("500K", False) == 500e3
    assert fv._parse("2.1M", False) == 2.1e6
    assert fv._parse("1T", False) == 1e12


def test_parse_percent_strings():
    from api.services.screener import finviz_universe as fv
    assert fv._parse("3.45%", True) == 3.45
    assert fv._parse("0.00%", True) == 0.0


def test_parse_plain_number():
    from api.services.screener import finviz_universe as fv
    assert fv._parse("12.3", False) == 12.3


def test_parse_dash_and_blank():
    from api.services.screener import finviz_universe as fv
    assert fv._parse("-", False) is None
    assert fv._parse("", False) is None
    assert fv._parse(None, False) is None


def test_parse_comma_thousands():
    from api.services.screener import finviz_universe as fv
    assert fv._parse("1,234", False) == 1234.0


def test_parse_junk_is_none():
    from api.services.screener import finviz_universe as fv
    assert fv._parse("N/A", False) is None
    assert fv._parse("abc%", True) is None


# ── FIX 1 (2026-08-22 receipts-fix): raw-millions scale for shares_outstanding
# /float_shares. Proven on prod: NVDA's bare export values were being stored
# as a literal share count (24221 shares instead of 24.22B).

def test_parse_raw_millions_bare_number_scales_by_1e6():
    from api.services.screener import finviz_universe as fv
    # NVDA prod receipt: bare 24221 -> 24,221,000,000 (true value ~24.22B)
    assert fv._parse("24221", False, raw_millions=True) == 24_221_000_000
    assert fv._parse("23280.5", False, raw_millions=True) == 23_280_500_000.0


def test_parse_raw_millions_suffixed_value_is_unaffected():
    """A suffixed value on a raw_millions column still parses via the
    suffix — the ×1e6 only fires when NO suffix was present."""
    from api.services.screener import finviz_universe as fv
    assert fv._parse("1.5B", False, raw_millions=True) == 1.5e9
    assert fv._parse("500K", False, raw_millions=True) == 500e3


def test_parse_raw_millions_never_touches_a_percent_column():
    """A percent string returns via the '%' branch before `raw_millions` is
    ever consulted — structurally impossible to scale a percent column,
    regardless of the flag's value."""
    from api.services.screener import finviz_universe as fv
    assert fv._parse("3.45%", True, raw_millions=True) == 3.45


def test_parse_raw_millions_dash_and_blank_still_none():
    from api.services.screener import finviz_universe as fv
    assert fv._parse("-", False, raw_millions=True) is None
    assert fv._parse("", False, raw_millions=True) is None


# ── the safe-degrade fetch path (no token -> no socket) ─────────────────

def test_fetch_csv_text_without_token_returns_empty(monkeypatch):
    monkeypatch.delenv("FINVIZ_API_KEY", raising=False)
    from api.services.screener import finviz_universe as fv
    assert fv._fetch_finviz_csv_text() == ""


# ── run_pull ──────────────────────────────────────────────────────────────

def test_run_pull_keeps_rows_and_writes_artifact(monkeypatch, tmp_path):
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: _make_full_csv())

    receipt = fv.run_pull()

    assert receipt["wrote"] is True
    assert receipt["rows"] == 1005
    assert receipt["kept"] == 1005
    assert receipt["missing_headers"] == []
    assert artifact.exists()

    payload = json.loads(artifact.read_text())
    row0 = payload["rows"]["T0000"]
    assert row0["shares_outstanding"] == 1.5e9
    assert row0["float_shares"] == 1.2e9
    assert row0["float_pct"] == 80.0
    assert row0["short_float_pct"] == 3.45
    assert row0["short_ratio"] == 2.1
    assert row0["insider_own_pct"] == 0.5
    assert row0["inst_pct"] == 85.3


def test_run_pull_scales_bare_shares_columns_as_raw_millions(monkeypatch, tmp_path):
    """2026-08-22 prod receipt: NVDA's bare export values (24221 /
    23280.5) are Finviz raw-millions, not a literal share count — a
    suffixed row elsewhere in the same pull is unaffected."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    rows = [_full_row(f"T{i:04d}") for i in range(1004)]
    rows.append(["NVDA", "24221", "23280.5", "80.00%", "3.45%", "2.1",
                 "0.50%", "85.30%"])
    csv_text = _csv(FULL_HEADERS, rows)
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: csv_text)

    fv.run_pull()

    payload = json.loads(artifact.read_text())
    nvda = payload["rows"]["NVDA"]
    assert nvda["shares_outstanding"] == 24_221_000_000
    assert nvda["float_shares"] == 23_280_500_000.0
    t0 = payload["rows"]["T0000"]
    assert t0["shares_outstanding"] == 1.5e9  # suffixed row: unaffected


def test_run_pull_records_missing_header_and_still_writes(monkeypatch, tmp_path):
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    headers = [h for h in FULL_HEADERS if h != "Float %"]

    def _csv_without_float_pct():
        rows = [[f"T{i:04d}", "1.50B", "1.20B", "3.45%", "2.1", "0.50%", "85.30%"]
                 for i in range(1005)]
        return _csv(headers, rows)

    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", _csv_without_float_pct)

    receipt = fv.run_pull()

    assert receipt["missing_headers"] == ["float_pct"]
    assert receipt["wrote"] is True
    payload = json.loads(artifact.read_text())
    row0 = payload["rows"]["T0000"]
    assert "float_pct" not in row0
    assert row0["short_float_pct"] == 3.45


def test_run_pull_refuses_below_min_rows_and_preserves_prior(monkeypatch, tmp_path):
    artifact = tmp_path / "finviz.json"
    prior_payload = {"as_of": "2020-01-01T00:00:00+00:00",
                      "missing_headers": [], "rows": {"OLD": {"short_ratio": 9.9}}}
    artifact.write_text(json.dumps(prior_payload))
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    small_csv = _csv(FULL_HEADERS, [_full_row("A")])
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: small_csv)

    receipt = fv.run_pull()

    assert receipt["wrote"] is False
    assert receipt["kept"] == 1
    assert receipt["rows"] == 1
    after = json.loads(artifact.read_text())
    assert after == prior_payload  # byte-for-byte untouched


def test_run_pull_drops_a_row_with_no_ticker(monkeypatch, tmp_path):
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    rows = [_full_row(f"T{i:04d}") for i in range(1005)]
    rows.append(["", "1.0B", "1.0B", "10%", "1%", "1.0", "1%", "1%"])
    csv_text = _csv(FULL_HEADERS, rows)
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: csv_text)

    receipt = fv.run_pull()

    assert receipt["rows"] == 1006
    assert receipt["kept"] == 1005  # the blank-ticker row never made it in


# ── read_finviz_fields ──────────────────────────────────────────────────

def _write_artifact(tmp_path, monkeypatch, rows, as_of=None, missing_headers=None):
    artifact = tmp_path / "finviz.json"
    artifact.write_text(json.dumps({
        "as_of": as_of or _now_iso(),
        "missing_headers": missing_headers or [],
        "rows": rows,
    }))
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    return artifact


def test_read_finviz_fields_healthy(monkeypatch, tmp_path):
    rows = {f"T{i:04d}": {"short_float_pct": 12.5, "short_ratio": 3.0}
            for i in range(1005)}
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import finviz_universe as fv

    out = fv.read_finviz_fields(["T0000", "ZZZZ"])

    assert out["T0000"]["short_float_pct"] == 12.5
    assert out["T0000"]["short_ratio"] == 3.0
    assert out["ZZZZ"] == {}


def test_read_finviz_fields_missing_artifact(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(tmp_path / "nope.json"))
    from api.services.screener import finviz_universe as fv

    failures = {}
    out = fv.read_finviz_fields(["AAA"], failures=failures)

    assert out == {}
    assert failures["finviz_universe"]["missing"] == 1


def test_read_finviz_fields_short_artifact_counts_missing(tmp_path, monkeypatch):
    _write_artifact(tmp_path, monkeypatch, {"AAA": {"short_ratio": 1.0}})
    from api.services.screener import finviz_universe as fv

    failures = {}
    out = fv.read_finviz_fields(["AAA"], failures=failures)

    assert out == {}
    assert failures["finviz_universe"]["missing"] == 1


def test_read_finviz_fields_stale_is_served_but_counted(tmp_path, monkeypatch):
    old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    rows = {f"T{i:04d}": {"short_ratio": 1.0} for i in range(1005)}
    _write_artifact(tmp_path, monkeypatch, rows, as_of=old)
    from api.services.screener import finviz_universe as fv

    failures = {}
    out = fv.read_finviz_fields(["T0000"], failures=failures)

    assert out["T0000"]["short_ratio"] == 1.0
    assert any(k.startswith("stale:") for k in failures["finviz_universe"])


def test_read_finviz_fields_fresh_artifact_not_counted_stale(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": {"short_ratio": 1.0} for i in range(1005)}
    _write_artifact(tmp_path, monkeypatch, rows)  # as_of defaults to now
    from api.services.screener import finviz_universe as fv

    failures = {}
    out = fv.read_finviz_fields(["T0000"], failures=failures)

    assert out["T0000"]["short_ratio"] == 1.0
    assert failures == {}


def test_read_finviz_fields_missing_header_absent_from_every_row(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": {"short_ratio": 1.0} for i in range(1005)}
    _write_artifact(tmp_path, monkeypatch, rows, missing_headers=["float_pct"])
    from api.services.screener import finviz_universe as fv

    out = fv.read_finviz_fields(["T0000"])

    assert "float_pct" not in out["T0000"]
    assert out["T0000"]["short_ratio"] == 1.0


def test_read_finviz_fields_per_ticker_value_absence(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": {"short_ratio": 1.0} for i in range(1004)}
    rows["T9999"] = {}  # this ticker's short_ratio parsed to None (a dash)
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import finviz_universe as fv

    out = fv.read_finviz_fields(["T0000", "T9999"])

    assert out["T0000"]["short_ratio"] == 1.0
    assert "short_ratio" not in out["T9999"]
