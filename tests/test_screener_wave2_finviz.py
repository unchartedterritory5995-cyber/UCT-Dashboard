"""Wave 2 Task 3: finviz_universe — _parse shapes, run_pull, read_finviz_fields.

No sockets anywhere: every run_pull test monkeypatches
`_fetch_finviz_csv_text`; every reader test only touches a JSON file under
`tmp_path` via `SCREENER_FINVIZ_ARTIFACT`.
"""
import json
from datetime import datetime, timedelta, timezone

# ⛔ 2026-08-22: "Float %" is DELIBERATELY ABSENT — c=129 measured "Exchange"
# live, no Float % column exists in the v152 export (see finviz_universe's
# module docstring ADJUDICATION). float_pct is derived, never requested.
# Wave 6 (T6): the "Insider Transactions".."Shortable" headers are the
# module's GUESSES at the export's fuller names for page-verified ids
# 27/29/80/83 — the first real pull's `missing_headers` receipt adjudicates
# the spelling (a miss degrades honestly), so these fixtures deliberately
# serve the guessed spellings.
# Wave 6 (parity2): the last three headers are the same class of GUESS for
# page-verified ids 19/20/21 (EPS Past 5Y / EPS Next 5Y / Sales Past 5Y).
# EPS Q/Q / Sales Q/Q (ids 22/23) are deliberately absent — never requested;
# `eps_growth`/`rev_growth` already carry those exact facts.
FULL_HEADERS = [
    "Ticker", "Shares Outstanding", "Shares Float",
    "Short Float", "Short Ratio", "Insider Ownership",
    "Institutional Ownership",
    "Insider Transactions", "Institutional Transactions",
    "Optionable", "Shortable",
    "EPS Growth Past 5 Years", "EPS Growth Next 5 Years",
    "Sales Growth Past 5 Years",
]


def _csv(headers, rows):
    lines = [",".join(headers)]
    for r in rows:
        lines.append(",".join(str(x) for x in r))
    return "\n".join(lines) + "\n"


def _full_row(ticker):
    # The growth trio's -12.40% keeps a SIGNED NEGATIVE in the shared fixture
    # on purpose — shrinking-EPS names are normal and the sign must survive.
    return [ticker, "1.50B", "1.20B", "3.45%", "2.1", "0.50%", "85.30%",
            "-2.34%", "1.85%", "Yes", "No",
            "-12.40%", "22.50%", "8.75%"]


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


def test_parse_signed_percent():
    """The Wave 6 transactions pair is SIGNED — net insider selling is a
    negative percentage and must survive the parse with its sign."""
    from api.services.screener import finviz_universe as fv
    assert fv._parse("-2.34%", True) == -2.34
    assert fv._parse("1.85%", True) == 1.85


# ── Wave 6 (T6): is_pct is REAL now — it drives the bare-percent receipt ─────

def test_parse_counts_a_bare_percent_and_still_parses_it():
    """A `_PCT_COLUMNS` member served WITHOUT its '%' suffix parses the bare
    number (no magnitude guessing) and is COUNTED in `receipt['bare_pct']` —
    honest disclosure, never a silent unguarded parse."""
    from api.services.screener import finviz_universe as fv
    receipt = {}
    assert fv._parse("12.3", True, receipt=receipt) == 12.3
    assert receipt["bare_pct"] == 1
    # A properly-suffixed percent is NOT counted.
    assert fv._parse("3.45%", True, receipt=receipt) == 3.45
    assert receipt["bare_pct"] == 1
    # A non-percent column never counts, suffix or not.
    assert fv._parse("12.3", False, receipt=receipt) == 12.3
    assert fv._parse("1.5B", False, receipt=receipt) == 1.5e9
    assert receipt["bare_pct"] == 1
    # An unparseable value on a pct column is None, not a count.
    assert fv._parse("-", True, receipt=receipt) is None
    assert fv._parse("N/A", True, receipt=receipt) is None
    assert receipt["bare_pct"] == 1


def test_parse_without_a_receipt_still_parses_bare_percent():
    """The counter is optional — the direct-call sites in these tests and any
    future caller without a receipt keep the old behavior byte-for-byte."""
    from api.services.screener import finviz_universe as fv
    assert fv._parse("12.3", True) == 12.3


# ── Wave 6 (T6): the boolean parse class (Optionable / Shortable) ───────────

def test_parse_bool_yes_no_else_none():
    from api.services.screener import finviz_universe as fv
    assert fv._parse_bool("Yes") == 1
    assert fv._parse_bool("No") == 0
    # Case/whitespace tolerant — Finviz serves "Yes"/"No" but a parse class
    # should not silently drop a re-cased value.
    assert fv._parse_bool(" yes ") == 1
    assert fv._parse_bool("NO") == 0
    # Everything else is honest-None, never a guessed 0.
    assert fv._parse_bool("") is None
    assert fv._parse_bool(None) is None
    assert fv._parse_bool("-") is None
    assert fv._parse_bool("Maybe") is None


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


# ── FIX 2 (2026-08-22 receipts-fix): float_pct is DERIVED, not requested.

def test_derive_float_pct_normal_row():
    from api.services.screener import finviz_universe as fv
    row = {"float_shares": 23280.5, "shares_outstanding": 24221}
    assert fv._derive_float_pct(row) == 96.12


def test_derive_float_pct_none_when_either_side_missing():
    from api.services.screener import finviz_universe as fv
    assert fv._derive_float_pct({"shares_outstanding": 100}) is None
    assert fv._derive_float_pct({"float_shares": 50}) is None
    assert fv._derive_float_pct({}) is None


def test_derive_float_pct_none_when_shares_outstanding_is_zero():
    from api.services.screener import finviz_universe as fv
    assert fv._derive_float_pct(
        {"float_shares": 50, "shares_outstanding": 0}) is None


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
    # Wave 6: a clean pull (every pct value suffixed) counts ZERO bare percents.
    assert receipt["bare_pct"] == 0
    assert artifact.exists()

    payload = json.loads(artifact.read_text())
    row0 = payload["rows"]["T0000"]
    assert row0["shares_outstanding"] == 1.5e9
    assert row0["float_shares"] == 1.2e9
    # float_pct is derived at READ time, never stored in the artifact itself.
    assert "float_pct" not in row0
    assert row0["short_float_pct"] == 3.45
    assert row0["short_ratio"] == 2.1
    assert row0["insider_own_pct"] == 0.5
    assert row0["inst_pct"] == 85.3
    # Wave 6 (T6): the transactions pair keeps its sign; the flags are 1/0.
    assert row0["insider_trans_pct"] == -2.34
    assert row0["inst_trans_pct"] == 1.85
    assert row0["optionable"] == 1
    assert row0["shortable"] == 0
    # Wave 6 (parity2): the growth trio keeps its sign — a shrinking 5-year
    # EPS base is a NEGATIVE fact, not a parse casualty.
    assert row0["eps_past_5y_growth"] == -12.4
    assert row0["eps_next_5y_growth"] == 22.5
    assert row0["sales_past_5y_growth"] == 8.75

    out = fv.read_finviz_fields(["T0000"])
    assert out["T0000"]["float_pct"] == 80.0  # 1.2e9 / 1.5e9 * 100
    # ...and the Wave 6 columns flow through the reader unchanged.
    assert out["T0000"]["insider_trans_pct"] == -2.34
    assert out["T0000"]["inst_trans_pct"] == 1.85
    assert out["T0000"]["optionable"] == 1
    assert out["T0000"]["shortable"] == 0
    assert out["T0000"]["eps_past_5y_growth"] == -12.4
    assert out["T0000"]["eps_next_5y_growth"] == 22.5
    assert out["T0000"]["sales_past_5y_growth"] == 8.75


def test_run_pull_never_lists_float_pct_as_a_missing_header(monkeypatch, tmp_path):
    """2026-08-22: float_pct is no longer a requested Finviz column at all,
    so it can never appear in `missing_headers` — there is no header left to
    go missing (see finviz_universe's module docstring ADJUDICATION)."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: _make_full_csv())

    receipt = fv.run_pull()

    assert "float_pct" not in receipt["missing_headers"]
    assert "float_pct" not in fv._HEADERS


def test_run_pull_scales_bare_shares_columns_as_raw_millions(monkeypatch, tmp_path):
    """2026-08-22 prod receipt: NVDA's bare export values (24221 /
    23280.5) are Finviz raw-millions, not a literal share count — a
    suffixed row elsewhere in the same pull is unaffected."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    rows = [_full_row(f"T{i:04d}") for i in range(1004)]
    rows.append(["NVDA", "24221", "23280.5", "3.45%", "2.1", "0.50%", "85.30%",
                 "-2.34%", "1.85%", "Yes", "Yes", "-12.40%", "22.50%", "8.75%"])
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

    headers = [h for h in FULL_HEADERS if h != "Institutional Ownership"]

    def _csv_without_inst_pct():
        rows = [[f"T{i:04d}", "1.50B", "1.20B", "3.45%", "2.1", "0.50%",
                 "-2.34%", "1.85%", "Yes", "No", "-12.40%", "22.50%", "8.75%"]
                 for i in range(1005)]
        return _csv(headers, rows)

    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", _csv_without_inst_pct)

    receipt = fv.run_pull()

    assert receipt["missing_headers"] == ["inst_pct"]
    assert receipt["wrote"] is True
    payload = json.loads(artifact.read_text())
    row0 = payload["rows"]["T0000"]
    assert "inst_pct" not in row0
    assert row0["short_float_pct"] == 3.45


def test_run_pull_missing_wave6_headers_degrade_by_name(monkeypatch, tmp_path):
    """The header spellings for ids 27/29/80/83 are GUESSES until the first
    real pull adjudicates them — a wrong guess must land in `missing_headers`
    name-for-name (all four), never a wrong value, and never a failed pull."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    wave6 = {"Insider Transactions", "Institutional Transactions",
             "Optionable", "Shortable"}
    headers = [h for h in FULL_HEADERS if h not in wave6]

    def _csv_without_wave6():
        rows = [[f"T{i:04d}", "1.50B", "1.20B", "3.45%", "2.1", "0.50%",
                 "85.30%", "-12.40%", "22.50%", "8.75%"]
                for i in range(1005)]
        return _csv(headers, rows)

    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", _csv_without_wave6)

    receipt = fv.run_pull()

    assert receipt["missing_headers"] == [
        "insider_trans_pct", "inst_trans_pct", "optionable", "shortable"]
    assert receipt["wrote"] is True
    row0 = json.loads(artifact.read_text())["rows"]["T0000"]
    for col in ("insider_trans_pct", "inst_trans_pct", "optionable",
                "shortable"):
        assert col not in row0
    assert row0["inst_pct"] == 85.3  # the rest of the pull is untouched


def test_run_pull_missing_parity2_growth_headers_degrade_by_name(monkeypatch,
                                                                 tmp_path):
    """The header spellings for ids 19/20/21 are GUESSES until the first real
    pull adjudicates them — a wrong guess must land in `missing_headers`
    name-for-name (all three), never a wrong value, and never a failed pull."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    parity2 = {"EPS Growth Past 5 Years", "EPS Growth Next 5 Years",
               "Sales Growth Past 5 Years"}
    headers = [h for h in FULL_HEADERS if h not in parity2]

    def _csv_without_parity2():
        rows = [[f"T{i:04d}", "1.50B", "1.20B", "3.45%", "2.1", "0.50%",
                 "85.30%", "-2.34%", "1.85%", "Yes", "No"]
                for i in range(1005)]
        return _csv(headers, rows)

    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", _csv_without_parity2)

    receipt = fv.run_pull()

    # (`missing_headers` is served sorted — the receipt's contract.)
    assert receipt["missing_headers"] == [
        "eps_next_5y_growth", "eps_past_5y_growth", "sales_past_5y_growth"]
    assert receipt["wrote"] is True
    row0 = json.loads(artifact.read_text())["rows"]["T0000"]
    for col in ("eps_past_5y_growth", "eps_next_5y_growth",
                "sales_past_5y_growth"):
        assert col not in row0
    assert row0["inst_pct"] == 85.3  # the rest of the pull is untouched


def test_run_pull_growth_trio_signed_and_junk_is_absent(monkeypatch, tmp_path):
    """A SIGNED NEGATIVE growth survives the pull with its sign, and a '-'
    placeholder is honest-absence for that ticker's column — never a zero
    (0% growth is a real, different fact)."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    rows = [_full_row(f"T{i:04d}") for i in range(1004)]
    rows.append(["GDIM", "1.50B", "1.20B", "3.45%", "2.1", "0.50%", "85.30%",
                 "-2.34%", "1.85%", "Yes", "No", "-41.07%", "-", "-3.10%"])
    csv_text = _csv(FULL_HEADERS, rows)
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: csv_text)

    fv.run_pull()

    gdim = json.loads(artifact.read_text())["rows"]["GDIM"]
    assert gdim["eps_past_5y_growth"] == -41.07
    assert "eps_next_5y_growth" not in gdim   # '-' = no estimate published
    assert gdim["sales_past_5y_growth"] == -3.1


def test_run_pull_counts_a_bare_growth_percent_in_the_receipt(monkeypatch,
                                                              tmp_path):
    """The growth trio rides the same bare-percent receipt as the T6 pair: a
    `_PCT_COLUMNS` growth value served WITHOUT its '%' suffix parses the bare
    number (no magnitude guessing — negative growth is normal, so no
    heuristic is safe) and is COUNTED into `bare_pct`."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    rows = [_full_row(f"T{i:04d}") for i in range(1004)]
    rows.append(["BGRW", "1.50B", "1.20B", "3.45%", "2.1", "0.50%", "85.30%",
                 "-2.34%", "1.85%", "Yes", "No", "-12.40", "22.50%", "8.75%"])
    csv_text = _csv(FULL_HEADERS, rows)
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: csv_text)

    receipt = fv.run_pull()

    assert receipt["bare_pct"] == 1
    bgrw = json.loads(artifact.read_text())["rows"]["BGRW"]
    assert bgrw["eps_past_5y_growth"] == -12.4  # parsed bare, disclosed above


def test_qoq_pair_is_deliberately_not_requested():
    """⛔ THE SKIP IS A DECISION, PINNED. EPS Q/Q (id 22) and Sales Q/Q
    (id 23) were VERIFIED live in the same walk as ids 19/20/21 and are NOT
    requested: `eps_growth`/`rev_growth` already carry those exact facts
    (latest quarter vs the year-ago quarter — `earnings_growth_fmp`'s
    measured definition match). A future agent adding them here would put a
    second authority over two shipped columns; this test names the ruling."""
    from api.services.screener import finviz_universe as fv
    assert 22 not in fv._C_IDS.values()
    assert 23 not in fv._C_IDS.values()
    for col in fv._C_IDS:
        assert "qoq" not in col, (
            f"{col}: a QoQ column joined the finviz pull — eps_growth/"
            "rev_growth already own those facts (see _C_IDS's adjudication)")


def test_run_pull_counts_bare_percent_rows_in_the_receipt(monkeypatch, tmp_path):
    """One ticker's Insider Transactions arrives without its '%' suffix: the
    bare number is parsed as-is (no magnitude guessing) and the receipt's
    `bare_pct` counts exactly that one occurrence."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    rows = [_full_row(f"T{i:04d}") for i in range(1004)]
    rows.append(["BARE", "1.50B", "1.20B", "3.45%", "2.1", "0.50%", "85.30%",
                 "-2.34", "1.85%", "Yes", "No", "-12.40%", "22.50%", "8.75%"])
    csv_text = _csv(FULL_HEADERS, rows)
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: csv_text)

    receipt = fv.run_pull()

    assert receipt["bare_pct"] == 1
    assert receipt["wrote"] is True
    bare = json.loads(artifact.read_text())["rows"]["BARE"]
    assert bare["insider_trans_pct"] == -2.34  # parsed bare, disclosed above


def test_run_pull_bool_junk_is_absent_never_zero(monkeypatch, tmp_path):
    """A flag value that is neither Yes nor No ('-', blank, anything else) is
    honest-absence for that ticker's column — never a fabricated 0, which
    would read as a confident 'No'."""
    artifact = tmp_path / "finviz.json"
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(artifact))
    from api.services.screener import finviz_universe as fv

    rows = [_full_row(f"T{i:04d}") for i in range(1004)]
    rows.append(["JUNK", "1.50B", "1.20B", "3.45%", "2.1", "0.50%", "85.30%",
                 "-2.34%", "1.85%", "-", "Maybe", "-12.40%", "22.50%", "8.75%"])
    csv_text = _csv(FULL_HEADERS, rows)
    monkeypatch.setattr(fv, "_fetch_finviz_csv_text", lambda: csv_text)

    fv.run_pull()

    junk = json.loads(artifact.read_text())["rows"]["JUNK"]
    assert "optionable" not in junk
    assert "shortable" not in junk
    assert junk["insider_trans_pct"] == -2.34  # the row itself survived


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
    rows.append(["", "1.0B", "1.0B", "10%", "1.0", "1%", "1%",
                 "0.5%", "0.5%", "Yes", "Yes", "5%", "5%", "5%"])
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


# ── FIX 2 (2026-08-22): read_finviz_fields derives float_pct on read ────────

def test_read_finviz_fields_derives_float_pct_from_shares(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": {"shares_outstanding": 24221.0, "float_shares": 23280.5}
            for i in range(1005)}
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import finviz_universe as fv

    out = fv.read_finviz_fields(["T0000"])

    assert out["T0000"]["float_pct"] == 96.12


def test_read_finviz_fields_float_pct_none_without_both_shares_columns(tmp_path, monkeypatch):
    rows = {f"T{i:04d}": {"shares_outstanding": 24221.0} for i in range(1004)}
    rows["T9999"] = {"shares_outstanding": 0.0, "float_shares": 100.0}
    _write_artifact(tmp_path, monkeypatch, rows)
    from api.services.screener import finviz_universe as fv

    out = fv.read_finviz_fields(["T0000", "T9999"])

    assert "float_pct" not in out["T0000"]   # float_shares absent
    assert "float_pct" not in out["T9999"]   # shares_outstanding == 0
