"""Phase 3 unit 3-05 (engineering map docs/superpowers/plans/2026-11-08-uct-rs-
phase3-4-engineering-map.md): the `rsLine` row's three shapes behind two
import-time flags, the `string` input branch of `registry_defs.resolve_inputs`,
the refusal of an unknown input kind, the v4 benchmark menu (CUSTOM by name,
never in the alert lane) and the flag ledger rows.

THE CONTROL: with `RS_V3_ENABLED` unset the served row must be byte-identical to
the row production served before Phase 3. `tests/fixtures/rs_line_rows_pre_
phase3.json` froze those bytes from the tree this unit started on; the
subprocess tests below import `registry_defs` fresh under each flag state, so
the import-time read itself is exercised, not a function called with a bool.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

import pytest

from api.services import alert_rev_migration as rev
from api.services import alert_rs_series
from api.services import relative_strength as rsm
from api.services import rs_benchmarks as rb
from api.services.signature import registry_defs as rd

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "tests" / "fixtures" / "rs_line_rows_pre_phase3.json"
LEDGER = REPO / "docs" / "feature_flags.json"

V3_INPUT_KEYS = ["benchmark", "maLength", "maType", "lookback", "priceTolerance", "redDayThreshold",
                 "showNewHigh", "showNewHighBeforePrice", "shortHistoryDots",
                 "mansfieldLength", "showMansfield", "showRedDay", "showNewLow"]
V4_NEW_INPUT_KEYS = ["view", "customBenchmark", "rrgRatioLength", "rrgMomentumLength",
                     "clenowWindow", "clenowGapPct", "atrLength", "varsLookback", "anchorDate"]


def _frozen() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _served_row(v2: str | None, v3: str | None) -> tuple[str, str]:
    """`json.dumps(definition('rsLine'))` from a fresh interpreter whose
    environment carries exactly these two flags (None = unset), plus stderr."""
    env = {k: v for k, v in os.environ.items() if k not in ("RS_V2_ENABLED", "RS_V3_ENABLED")}
    if v2 is not None:
        env["RS_V2_ENABLED"] = v2
    if v3 is not None:
        env["RS_V3_ENABLED"] = v3
    code = ("import json, sys\n"
            "from api.services.signature import registry_defs as rd\n"
            "sys.stdout.write(json.dumps(rd.definition('rsLine')))\n")
    r = subprocess.run([sys.executable, "-c", code], cwd=str(REPO), env=env,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    return r.stdout, r.stderr


# ── the three shapes, from the import-time flags ─────────────────────────────

def test_v2_alone_serves_the_pre_phase3_v3_row_BYTE_FOR_BYTE():
    """⭐ THE CONTROL (map §4 Rollback): RS_V3_ENABLED unset, or 0, is today's row."""
    want = json.dumps(_frozen()["v3"])
    for v3 in (None, "0"):
        out, _ = _served_row("1", v3)
        assert out == want, f"RS_V3_ENABLED={v3!r} moved the v3 row"


def test_no_flags_serve_the_v1_row_byte_for_byte():
    out, err = _served_row(None, None)
    assert out == json.dumps(_frozen()["v1"])
    assert "RS_V3_ENABLED" not in err


def test_v3_alone_is_ignored_and_logged():
    out, err = _served_row(None, "1")
    assert out == json.dumps(_frozen()["v1"]), "V3 without V2 must not move the row"
    assert "RS_V3_ENABLED is set without RS_V2_ENABLED; ignored" in err


def test_both_flags_serve_the_v4_row():
    out, err = _served_row("1", "1")
    assert out == json.dumps(rd._rs_line_row(True, True))
    assert json.loads(out)["compute"]["rev"] == 5
    assert "ignored" not in err


def test_the_in_process_builder_reproduces_the_frozen_rows():
    frozen = _frozen()
    assert json.dumps(rd._rs_line_row(True)) == json.dumps(frozen["v3"])
    assert json.dumps(rd._rs_line_row(True, False)) == json.dumps(frozen["v3"])
    assert json.dumps(rd._rs_line_row(False)) == json.dumps(frozen["v1"])


def test_the_builder_logs_and_ignores_v3_without_v2(caplog):
    with caplog.at_level("WARNING", logger=rd.__name__):
        row = rd._rs_line_row(False, True)
    assert json.dumps(row) == json.dumps(_frozen()["v1"])
    assert any("ignored" in r.getMessage() for r in caplog.records)


def test_the_v4_row_is_the_v3_row_plus_the_phase3_contract():
    v3 = rd._rs_line_row(True)
    v4 = rd._rs_line_row(True, True)
    # Deepvue round 2 (2026-11-08): version and rev 5, the RS Rating Reading's two
    # wire columns after the Phase 3 six
    assert v4["version"] == rd.RS_V4_VERSION == 5
    assert v4["compute"] == {"kind": "server", "fn": "rsLine", "rev": 5}
    assert v4["columns"] == v3["columns"] + list(rd.RS_PHASE3_WIRE_COLUMNS) + list(rd.RS_RATING_WIRE_COLUMNS)
    assert len(v4["columns"]) == 30 and len(set(v4["columns"])) == 30
    assert v4["payload_keys"] == ["payload"]
    assert [i["key"] for i in v4["inputs"]] == V3_INPUT_KEYS + V4_NEW_INPUT_KEYS
    # every v3 input is unchanged except the benchmark menu, which gains CUSTOM,
    # and the legacy showMansfield, which declares its successor (unit 3-08b)
    legacy = {k: {**i, "mapsTo": dict(rd.RS_MANSFIELD_LEGACY_MAP)} if i["key"] == "showMansfield" else i
              for k, i in enumerate(v3["inputs"])}
    assert v4["inputs"][1:13] == [legacy[k] for k in range(1, len(v3["inputs"]))]
    assert "mapsTo" not in {i["key"]: i for i in v3["inputs"]}["showMansfield"]
    assert v4["inputs"][0] == {**v3["inputs"][0], "options": list(rd.RS_LINE_BENCHMARKS_V4)}
    for k in ("schemaVersion", "id", "meta", "placement", "rules_key"):
        assert v4[k] == v3[k], k


def test_the_v4_inputs_are_the_ones_the_map_declares():
    by_key = {i["key"]: i for i in rd._rs_line_row(True, True)["inputs"]}
    assert by_key["view"] == {"key": "view", "type": "enum", "default": "ratio",
                              "options": ["ratio", "mansfield", "rotation", "quality", "vars", "rating"]}
    assert by_key["customBenchmark"] == {
        "key": "customBenchmark", "type": "string", "default": "",
        "pattern": rb.CUSTOM_SYMBOL_RE.pattern, "maxLength": 10, "case": "upper"}
    assert by_key["anchorDate"] == {"key": "anchorDate", "type": "string", "default": "",
                                    "pattern": r"^\d{4}-\d{2}-\d{2}$"}
    numbers = {k: (by_key[k]["type"], by_key[k]["default"], by_key[k]["min"], by_key[k]["max"])
               for k in ("rrgRatioLength", "rrgMomentumLength", "clenowWindow", "clenowGapPct",
                         "atrLength", "varsLookback")}
    assert numbers == {
        "rrgRatioLength": ("int", 10, 3, 60),
        "rrgMomentumLength": ("int", 5, 2, 30),
        "clenowWindow": ("int", 90, 20, 252),
        "clenowGapPct": ("float", 15.0, 1.0, 50.0),
        "atrLength": ("int", 20, 5, 100),
        "varsLookback": ("int", 60, 10, 252),
    }
    # the defaults are the compute module's, read, not re-typed
    assert (by_key["rrgRatioLength"]["default"], by_key["rrgMomentumLength"]["default"]) == (
        rsm.DEFAULT_RRG_RATIO_LEN, rsm.DEFAULT_RRG_MOM_LEN)
    assert (by_key["clenowWindow"]["default"], by_key["clenowGapPct"]["default"]) == (
        rsm.DEFAULT_CLENOW_WINDOW, rsm.DEFAULT_CLENOW_GAP_PCT)
    assert (by_key["atrLength"]["default"], by_key["varsLookback"]["default"]) == (
        rsm.DEFAULT_ATR_LENGTH, rsm.DEFAULT_VARS_LOOKBACK)


def test_the_wire_subset_is_drawn_from_PHASE3_COLUMNS_or_is_a_dot_of_one():
    """`dotClenowGap` is the map's name for the gap MARKER: a wire-only dot the
    provider derives from `clenowGap` (the `dotMansfieldCross` precedent), so the
    wire carries the dot and not the 0/1 column."""
    assert rd.RS_PHASE3_WIRE_COLUMNS == ("rsRatio", "rsMomentum", "clenowScore", "dotClenowGap",
                                         "vars", "varsMa")
    for name in rd.RS_PHASE3_WIRE_COLUMNS:
        if name.startswith("dot"):
            base = name[3].lower() + name[4:]
            assert base in rsm.PHASE3_COLUMNS and name not in rsm.PHASE3_COLUMNS, name
        else:
            assert name in rsm.PHASE3_COLUMNS, name
    assert not set(rd.RS_PHASE3_WIRE_COLUMNS) & (set(rsm.PHASE1_COLUMNS) | set(rd.RS_PHASE2A_WIRE_COLUMNS))


def test_the_custom_max_length_is_the_longest_ticker_the_pattern_accepts():
    assert rb.CUSTOM_SYMBOL_RE.fullmatch("A" * 10) and not rb.CUSTOM_SYMBOL_RE.fullmatch("A" * 11)


def test_rev_5_is_one_number_in_both_python_lanes_and_the_migration_note_is_written_down():
    import inspect
    assert rd._rs_line_row(True, True)["compute"]["rev"] == rev.ADDRESS_REVS["rsLine"] == 5
    prose = " ".join(inspect.getsource(rev).replace("#", " ").split())
    assert "no runtime migrates rs_line bindings" in prose
    assert 'migrate_bindings_to_rev("rs_line", N, notify=...)' in prose


# ── the string branch ────────────────────────────────────────────────────────

@pytest.fixture
def v4_row(monkeypatch):
    row = rd._rs_line_row(True, True)
    monkeypatch.setitem(rd._BY_ID, "rsLine", row)
    return row


@pytest.mark.parametrize("raw, want", [
    ({}, ""),
    ({"customBenchmark": None}, ""),
    ({"customBenchmark": ""}, ""),
    ({"customBenchmark": "   "}, ""),
    ({"customBenchmark": " smh "}, "SMH"),
    ({"customBenchmark": "brk.b"}, "BRK.B"),
    ({"customBenchmark": "BF-B"}, "BF-B"),
    ({"customBenchmark": "ABCDEFGHIJ"}, "ABCDEFGHIJ"),
])
def test_custom_benchmark_is_stripped_and_upper_cased(v4_row, raw, want):
    assert rd.resolve_inputs("rsLine", raw)["customBenchmark"] == want


@pytest.mark.parametrize("value, phrase", [
    ("$SPX", "does not match the declared pattern"),
    ("^GSPC", "does not match the declared pattern"),
    ("1ABC", "does not match the declared pattern"),
    ("SM H", "does not match the declared pattern"),
    ("ABCDEFGHIJK", "past its declared maxLength"),
    ("ı", "outside ASCII"),
    ("ＳＭＨ", "outside ASCII"),
    (5, "expects text"),
    (["SMH"], "expects text"),
    (True, "expects text"),
])
def test_custom_benchmark_refusals(v4_row, value, phrase):
    with pytest.raises(rd.InputRejected, match=phrase):
        rd.resolve_inputs("rsLine", {"customBenchmark": value})


def test_the_refusal_phrases_are_disjoint(v4_row):
    """The module's rule: no two refusals share a phrase, so a `match=` cannot
    pass with the guard it names deleted."""
    phrases = ("does not match the declared pattern", "past its declared maxLength",
               "outside ASCII", "expects text", "has no branch for", "declares the case rule",
               "outside the enum vocabulary")
    samples = {}
    for value in ("$SPX", "ABCDEFGHIJK", "ı", 5):
        try:
            rd.resolve_inputs("rsLine", {"customBenchmark": value})
        except rd.InputRejected as e:
            samples[value] = str(e)
    assert len(samples) == 4
    for msg in samples.values():
        assert sum(p in msg for p in phrases) == 1, msg


@pytest.mark.parametrize("value", [
    "", " ", "smh", "SMH", "brk.b", "BF-B", "$SPX", "^GSPC", "1ABC", "SM H", "ABCDEFGHIJK",
    "ı", "ＳＭＨ", "A", "a-", "Z.", "nvda\n", "QQQ ",
])
def test_the_row_accepts_exactly_what_normalize_custom_symbol_accepts(v4_row, value):
    """ONE authority: the declared pattern IS `CUSTOM_SYMBOL_RE`, so the resolver
    and the benchmark resolver agree on every value (blank = not set in both)."""
    norm = rb.normalize_custom_symbol(value)
    try:
        got = rd.resolve_inputs("rsLine", {"customBenchmark": value})["customBenchmark"]
    except rd.InputRejected:
        got = None
    if value.strip() == "":
        assert got == "" and norm is None
    else:
        assert got == norm, (value, got, norm)


@pytest.mark.parametrize("value, want", [
    ("", ""), ("2026-11-03", "2026-11-03"), (" 2026-11-03 ", "2026-11-03"), ("2026-11-03\n", "2026-11-03"),
])
def test_anchor_date_accepts_the_shape_or_blank(v4_row, value, want):
    assert rd.resolve_inputs("rsLine", {"anchorDate": value})["anchorDate"] == want


@pytest.mark.parametrize("value", [
    "2026/11/03", "26-11-03", "2026-11-3", "2026-11-03x", "x2026-11-03", "20261103",
    "٢٠٢٦-١١-٠٣",  # Arabic-Indic digits: Python's \d takes them, the browser's RegExp does not
])
def test_anchor_date_refuses_anything_else(v4_row, value):
    with pytest.raises(rd.InputRejected, match="does not match the declared pattern"):
        rd.resolve_inputs("rsLine", {"anchorDate": value})


def test_the_v4_resolver_offers_custom_and_the_view_and_clamps_the_method(v4_row):
    out = rd.resolve_inputs("rsLine", {"benchmark": "CUSTOM", "customBenchmark": "smh", "view": "rotation",
                                       "rrgRatioLength": 999, "clenowGapPct": 0, "varsLookback": "abc",
                                       "lineColor": "#fff"})
    assert out["benchmark"] == "CUSTOM" and out["customBenchmark"] == "SMH" and out["view"] == "rotation"
    assert out["rrgRatioLength"] == 60 and out["clenowGapPct"] == 1.0 and out["varsLookback"] == 60
    assert "lineColor" not in out
    assert set(out) == set(V3_INPUT_KEYS + V4_NEW_INPUT_KEYS)
    with pytest.raises(rd.InputRejected, match="outside the enum vocabulary"):
        rd.resolve_inputs("rsLine", {"view": "bogus"})


def test_the_v3_row_still_refuses_custom_and_drops_the_phase3_keys(monkeypatch):
    """Rollback (map §4): a saved v4 instance under a v3 server draws the ratio,
    because the undeclared Phase 3 keys are dropped; CUSTOM is not a v3 option."""
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True))
    out = rd.resolve_inputs("rsLine", {"view": "rotation", "customBenchmark": "SMH", "anchorDate": "x"})
    assert set(out) == set(V3_INPUT_KEYS)
    with pytest.raises(rd.InputRejected, match="outside the enum vocabulary"):
        rd.resolve_inputs("rsLine", {"benchmark": "CUSTOM"})


# ── an unknown kind is refused, never stored raw ─────────────────────────────

def _fake_def(monkeypatch, inputs):
    monkeypatch.setitem(rd._BY_ID, "zzStringTest", {"id": "zzStringTest", "inputs": inputs})


def test_an_unknown_input_kind_is_refused_not_passed_through(monkeypatch):
    _fake_def(monkeypatch, [{"key": "when", "type": "time", "default": 0}])
    with pytest.raises(rd.InputRejected, match="has no branch for"):
        rd.resolve_inputs("zzStringTest", {"when": "anything"})


def test_an_unknown_case_rule_is_refused(monkeypatch):
    _fake_def(monkeypatch, [{"key": "s", "type": "string", "default": "", "case": "title"}])
    with pytest.raises(rd.InputRejected, match="declares the case rule"):
        rd.resolve_inputs("zzStringTest", {"s": "abc"})


def test_a_string_without_case_keeps_its_case_and_a_lower_rule_lowers(monkeypatch):
    _fake_def(monkeypatch, [{"key": "a", "type": "string", "default": ""},
                            {"key": "b", "type": "string", "default": "", "case": "lower"}])
    assert rd.resolve_inputs("zzStringTest", {"a": " MiXed ", "b": "MiXed"}) == {"a": "MiXed", "b": "mixed"}


def test_every_shipped_row_declares_only_kinds_the_resolver_knows(monkeypatch):
    """So the unknown-kind refusal can never fire on a production request, and
    every row's own defaults resolve (an empty request is never refused)."""
    known = {"enum", "int", "float", "bool", "string"}
    rows = list(rd.SERVER_DEFS) + [rd._rs_line_row(False), rd._rs_line_row(True), rd._rs_line_row(True, True)]
    kinds = {i["type"] for row in rows for i in row["inputs"]}
    assert kinds <= known, kinds - known
    for row in rows:
        monkeypatch.setitem(rd._BY_ID, row["id"], row)
        out = rd.resolve_inputs(row["id"], {})
        assert set(out) == {i["key"] for i in row["inputs"]}, row["id"]


# ── CUSTOM never reaches the alert lane ──────────────────────────────────────

def test_the_alert_benchmarks_have_no_custom():
    assert "CUSTOM" not in alert_rs_series.RS_ALERT_BENCHMARKS
    assert rb.CUSTOM_BENCHMARK in alert_rs_series.RS_ALERT_EXCLUDED_BENCHMARKS, "excluded BY NAME"
    assert alert_rs_series.RS_ALERT_BENCHMARKS == ("SPY", "RSP", "SECTOR", "QQQ", "IWM"), \
        "Phase 3 left the alert menu exactly as it was"


def test_an_rs_alert_on_custom_is_refused_with_a_reason():
    why = alert_rs_series.rs_refusal("rs_line.value", {"benchmark": "CUSTOM"})
    assert why and "chart-only" in why
    assert alert_rs_series.rs_refusal("rs_line.value", {"benchmark": "SPY"}) is None, "control"


# ── the flag ledger ──────────────────────────────────────────────────────────

def test_the_ledger_carries_rs_v3_dark_on_web_with_its_arming_note():
    raw = LEDGER.read_bytes()
    assert raw.count(b"\n") == raw.count(b"\r\n"), "docs/feature_flags.json is a CRLF file"
    flags = json.loads(raw.decode("utf-8"))["flags"]
    e = flags["RS_V3_ENABLED"]
    assert e["status"] == "dark" and e["where"] == ["web"]
    for must in ("unit 3-05", "import", "RS_V2_ENABLED", "IGNORED", "railway variables --service web --set RS_V3_ENABLED=1",
                 "railway redeploy --service web --yes", "Rollback", "rev 4", "CUSTOM"):
        assert must in e["note"], must
    text = raw.decode("utf-8")
    assert text.index('"RS_V2_ENABLED"') < text.index('"RS_V3_ENABLED"'), "beside its sibling"


@pytest.mark.parametrize("name, where", [
    ("RS_V2_ENABLED", ["web"]), ("RS_HISTORY_ENABLED", ["web"]), ("RS_EVIDENCE_ENABLED", ["worker"]),
])
def test_the_ledger_records_the_rs_flags_the_owner_armed(name, where):
    e = json.loads(LEDGER.read_text(encoding="utf-8"))["flags"][name]
    assert e["status"] == "armed" and e["since"] == "2026-11-07" and e["where"] == where
    assert e["note"].startswith(f"ARMED on {where[0]} 2026-11-07")
