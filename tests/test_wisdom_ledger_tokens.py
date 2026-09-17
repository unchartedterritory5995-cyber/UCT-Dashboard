"""R48 — ledger entries carry their token counts, and an ABSENT count is unknown, never zero.

⛔⛔ THE FAILURE THIS GUARDS, and it is a spend failure, not a bookkeeping one. R36 reserves from
measured history. R48 lets it reserve from measured TOKENS, which is the form the ruling actually
asks for. The 28 entries written before R48 carry no token counts at all — and `dict.get(k, 0)` is
the natural way to read a JSON field, so the natural reading of those 28 is "used no tokens". An
estimator that averaged those zeros in would compute a p90 far under what a real request costs,
reserve under it, and let ACTUALS walk past a cap that is only tested at reserve time. The one
thing standing between the ledger and that is the rule that an absent count is SKIPPED.

⭐ The three-branch test is the other half: a preference order nobody exercises is a preference
order that silently collapses to whichever branch happens to fire.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
from types import SimpleNamespace as NS

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
TOOLS = REPO / "tools" / "wisdom"

MODEL = "claude-opus-5"
#: opus-5 batch pricing, from budget.PRICES_PER_MTOK — restated only to make the arithmetic in
#: these tests readable; every assertion that depends on it goes through budget.estimate_cost.
_IN_PER_MTOK, _OUT_PER_MTOK, _BATCH = 5.0, 25.0, 0.5


def _load(name: str):
    if str(TOOLS) not in sys.path:
        sys.path.insert(0, str(TOOLS))
    spec = importlib.util.spec_from_file_location(f"wisdom_tool_{name}", TOOLS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gate = _load("extract_golden_gate")


def _params(max_tokens: int = 32000):
    return {"model": MODEL, "max_tokens": max_tokens, "system": [{"type": "text", "text": "s"}],
            "messages": [{"role": "user", "content": "x"}], "output_config": {}}


def _old_entry(usd: float, requests: int = 10):
    """A pre-R48 entry: cost and a request count, NO token fields. This is what the 28 look like."""
    return {"phase": "gate", "model": MODEL, "transport": "batch", "batch_id": "b",
            "requests": requests, "collected": True, "usd": usd, "at": "2026-09-15T00-00-00Z"}


def _r48_entry(input_tokens: int, output_tokens: int, usd: float = 1.0, requests: int = 10):
    return dict(_old_entry(usd, requests), input_tokens=input_tokens, output_tokens=output_tokens,
                extractor_version="wx-v0-fc47bc97", run_id="r", golden_file="g.jsonl", rounds=1)


# ── THE LOAD-BEARING ONE ─────────────────────────────────────────────────────

def test_an_entry_without_token_counts_is_unknown_never_zero():
    """⛔⛔ Read as zeros, twelve pre-R48 entries would drag any p90 to nothing."""
    old = [_old_entry(1.0) for _ in range(12)]
    assert gate.measured_token_reservation_usd(old, MODEL, batch=True) is None, \
        "pre-R48 entries were treated as having measured tokens"

    # ⭐ NON-VACUITY: the same call over entries that DO carry counts returns a number, so the
    # None above is the skip rule firing and not the function being inert.
    fresh = old + [_r48_entry(20000, 5000), _r48_entry(20000, 5000)]
    assert gate.measured_token_reservation_usd(fresh, MODEL, batch=True) is not None

    # ⛔ AND THE ZEROS MUST NOT HAVE BEEN AVERAGED IN. With 12 zero-token entries silently counted,
    # the p90 over 14 values would land in the zero bulk; with them skipped it is the measured one.
    from api.services.wisdom.extract import budget
    expected = budget.estimate_cost(MODEL, int(round(2000 * 1.5)), int(round(500 * 1.5)), batch=True)
    assert gate.measured_token_reservation_usd(fresh, MODEL, batch=True) == pytest.approx(expected)


def test_a_zero_token_entry_is_distinguishable_from_an_absent_one():
    """A real measured zero is honoured; the two must not collapse into one another."""
    zeros = [_r48_entry(0, 0) for _ in range(3)]
    assert gate.measured_token_reservation_usd(zeros, MODEL, batch=True) == pytest.approx(0.0)
    absent = [_old_entry(1.0) for _ in range(3)]
    assert gate.measured_token_reservation_usd(absent, MODEL, batch=True) is None


# ── THE THREE BRANCHES OF reservation_usd ────────────────────────────────────

def test_branch_1_token_history_wins_when_two_entries_carry_counts():
    from api.services.wisdom.extract import budget

    assert gate.RESERVE_MIN_TOKEN_HISTORY == 2
    # ⭐ enough entries that BOTH estimators are live, so the assertion below discriminates between
    # them rather than passing because only one of them could answer.
    n = max(gate.RESERVE_MIN_TOKEN_HISTORY, gate.RESERVE_MIN_HISTORY)
    entries = [_r48_entry(20000, 5000) for _ in range(n)]
    got = gate.reservation_usd(_params(), MODEL, batch=True, entries=entries)
    expected = budget.estimate_cost(MODEL, 3000, 750, batch=True)
    assert got == pytest.approx(expected)
    # it must be the TOKEN estimate, not the cost-per-request one, which would give usd/requests
    cost_based = gate.measured_reservation_usd(entries, MODEL, transport="batch")
    assert cost_based is not None and got != pytest.approx(cost_based)
    # and exactly two token-bearing entries are already enough to prefer it
    assert gate.reservation_usd(_params(), MODEL, batch=True,
                                entries=entries[:2]) == pytest.approx(expected)


def test_branch_2_falls_back_to_cost_per_request_when_no_entry_carries_tokens():
    entries = [_old_entry(1.0) for _ in range(gate.RESERVE_MIN_HISTORY)]
    got = gate.reservation_usd(_params(), MODEL, batch=True, entries=entries)
    assert got == pytest.approx(0.1 * gate.RESERVE_P90_MULTIPLIER)  # 1.0 usd / 10 requests


def test_branch_3_falls_back_to_the_worst_case_ceiling_when_nothing_is_measured():
    ceiling = gate.worst_case_usd(_params(), MODEL, batch=True)
    assert gate.reservation_usd(_params(), MODEL, batch=True, entries=[]) == pytest.approx(ceiling)
    # one token entry is below RESERVE_MIN_TOKEN_HISTORY and one cost entry below RESERVE_MIN_HISTORY
    assert gate.reservation_usd(_params(), MODEL, batch=True,
                                entries=[_r48_entry(20000, 5000)]) == pytest.approx(ceiling)


def test_a_token_estimate_is_still_capped_by_the_ceiling():
    """⛔ Reserving above the worst case would be strictly worse than the rule R36 replaced."""
    huge = [_r48_entry(10_000_000, 10_000_000) for _ in range(3)]
    ceiling = gate.worst_case_usd(_params(), MODEL, batch=True)
    assert gate.reservation_usd(_params(), MODEL, batch=True, entries=huge) == pytest.approx(ceiling)


def test_history_is_filtered_by_model_and_transport():
    entries = [dict(_r48_entry(20000, 5000), model="other") for _ in range(4)]
    assert gate.measured_token_reservation_usd(entries, MODEL, batch=True) is None
    streamed = [dict(_r48_entry(20000, 5000), transport="stream") for _ in range(4)]
    assert gate.measured_token_reservation_usd(streamed, MODEL, batch=True) is None
    assert gate.measured_token_reservation_usd(streamed, MODEL, batch=False) is not None


# ── token_fields: the writer side of "absent, never zero" ────────────────────

def test_token_fields_are_absent_when_nothing_was_measured():
    assert gate.token_fields(0, 0, observed=0, sent=40) == {}


def test_token_fields_are_absent_for_a_partially_collected_batch():
    """⛔ `requests` counts what was SENT, so a partial batch has the wrong denominator."""
    assert gate.token_fields(19_000, 4_000, observed=38, sent=40) == {}
    assert gate.token_fields(20_000, 5_000, observed=40, sent=40) == {
        "input_tokens": 20_000, "output_tokens": 5_000}


def test_input_tokens_sum_the_same_three_keys_the_calibration_row_does():
    src = (REPO / "api" / "services" / "wisdom" / "extract" / "golden.py").read_text(encoding="utf-8")
    body = src.split("def calibration", 1)[1][:1200]
    for key in gate.INPUT_TOKEN_KEYS:
        assert key in body, f"{key} is summed by the ledger but not by golden.calibration"
    assert gate._input_tokens({"input_tokens": 10, "cache_read_input_tokens": 5,
                               "cache_creation_input_tokens": 2}) == 17
    assert gate._input_tokens({}) == 0


# ── a REAL settle through the real batch round ───────────────────────────────

class _Batches:
    def __init__(self, ends=True, succeed=True):
        self.ends, self.succeed, self.created = ends, succeed, []

    def create(self, requests):
        self.created.append(list(requests))
        return NS(id=f"batch_{len(self.created)}")

    def retrieve(self, batch_id):
        return NS(processing_status="ended" if self.ends else "in_progress")

    def results(self, batch_id):
        usage = NS(input_tokens=1000, output_tokens=100, cache_read_input_tokens=7,
                   cache_creation_input_tokens=3, cache_creation=None)
        for req in self.created[int(batch_id.split("_")[1]) - 1]:
            if not self.succeed:
                yield NS(custom_id=req["custom_id"],
                         result=NS(type="errored", error=NS(error=NS(type="overloaded"))))
                continue
            message = NS(content=[NS(type="text", text='{"segment_id": "x", "records": []}')],
                         stop_reason="end_turn", usage=usage)
            yield NS(custom_id=req["custom_id"], result=NS(type="succeeded", message=message))


def _round(tmp_path, name, *, ends=True, succeed=True, n=2, extra=None):
    cap = gate.SpendCap(tmp_path / f"{name}.json", 100.0)
    client = NS(messages=NS(batches=_Batches(ends=ends, succeed=succeed)))
    gate.run_batch_round(client, [(i, _params()) for i in range(n)], model=MODEL, spend=cap,
                         phase="gate", poll_s=0, timeout_s=0 if not ends else 5,
                         log=lambda *_: None, ledger_extra=extra)
    return cap


def test_a_collected_batch_records_every_ruled_field(tmp_path):
    extra = {"extractor_version": "wx-v0-fc47bc97", "run_id": "2026-09-15T00-00-00Z",
             "golden_file": "golden-dev-v1.1.jsonl"}
    cap = _round(tmp_path, "ok", extra=extra)
    entry = cap.entries[-1]
    for field in ("input_tokens", "output_tokens", "requests", "extractor_version", "model",
                  "golden_file", "run_id", "rounds"):
        assert field in entry, f"R48 field {field} is missing from a settled entry"
    assert entry["input_tokens"] == 2 * (1000 + 7 + 3) and entry["output_tokens"] == 2 * 100
    assert entry["requests"] == 2 and entry["rounds"] == 1
    assert entry["golden_file"] == "golden-dev-v1.1.jsonl"


def test_a_timed_out_batch_records_no_token_fields(tmp_path):
    cap = _round(tmp_path, "stuck", ends=False)
    entry = cap.entries[-1]
    assert entry["collected"] is False and entry["usd"] > 0
    assert "input_tokens" not in entry and "output_tokens" not in entry, \
        "a batch nobody collected reported a token count it never measured"
    assert entry["requests"] == 2 and entry["rounds"] == 1  # the non-token half is still honest


def test_a_batch_whose_every_result_errored_records_no_token_fields(tmp_path):
    cap = _round(tmp_path, "errored", succeed=False)
    entry = cap.entries[-1]
    assert entry["collected"] is True and "output_tokens" not in entry


def test_the_settle_note_can_never_override_usd_or_the_transport_it_describes(tmp_path):
    """⛔ ledger_extra is caller-supplied; the settle site's own facts must win."""
    cap = _round(tmp_path, "clash", extra={"model": "LIAR", "transport": "LIAR", "usd": 999.0})
    entry = cap.entries[-1]
    assert entry["model"] == MODEL and entry["transport"] == "batch"
    assert entry["usd"] != 999.0


# ── the 28 that already exist ────────────────────────────────────────────────

def test_a_new_entry_never_rewrites_an_existing_one(tmp_path):
    """⛔ 'existing entries untouched' is a property of the WRITE, checked on a real round trip."""
    ledger = tmp_path / "ledger.json"
    before = {"entries": [_old_entry(1.0), _old_entry(2.0)], "total_usd": 3.0, "cap_usd": 100.0}
    ledger.write_text(json.dumps(before, indent=1, sort_keys=True), encoding="utf-8")
    cap = gate.SpendCap(ledger, 100.0)
    cap.reserve(0.5)
    cap.settle(0.5, 0.25, {"phase": "gate", "model": MODEL, "transport": "batch",
                           "requests": 1, "input_tokens": 10, "output_tokens": 2})
    after = json.loads(ledger.read_text(encoding="utf-8"))
    assert after["entries"][:2] == before["entries"], "a prior entry changed"
    assert len(after["entries"]) == 3
    assert after["total_usd"] == pytest.approx(3.25)
    for absent in ("input_tokens", "output_tokens", "extractor_version"):
        assert absent not in after["entries"][0], "a token field was backfilled onto a pre-R48 entry"


def test_the_real_ledger_on_disk_still_has_no_token_fields():
    """The 28 entries are the control this whole file is about. If one grows a token count without
    a gate run, something rewrote history."""
    path = REPO / "data" / "wisdom" / "extract" / "spend-ledger.json"
    if not path.exists():
        pytest.skip("no persisted ledger in this checkout (gitignored tree)")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert len(data["entries"]) >= 28, "an empty or truncated ledger passes the loop vacuously"
    for entry in data["entries"]:
        assert "input_tokens" not in entry and "output_tokens" not in entry
    assert gate.measured_token_reservation_usd(data["entries"], MODEL, batch=True) is None


# ── one authority for the transport label ────────────────────────────────────

def _code_strings(path: pathlib.Path) -> set:
    """Every string LITERAL in the module that is not a docstring.

    ⛔⛔ CODE, NEVER PROSE. The first version of this check was a text scan and it matched the
    comment four lines above `transport_label` — the comment that EXPLAINS the bug it hunts. A
    text scan would have been "fixed" by deleting the explanation.
    """
    import ast

    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc is not None:
                body = node.body[0]
                docstrings.add(id(body.value))
    return {n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings}


def test_the_transport_label_has_one_definition():
    assert gate.transport_label(batch=True) == "batch"
    assert gate.transport_label(batch=False) == "stream"
    strings = _code_strings(TOOLS / "extract_golden_gate.py")
    assert "sync" not in strings, "the dead 'sync' transport lookup is back"
    # ⭐ CONTROL: the scanner really can see a literal of this shape in this file.
    assert "batch" in strings and "stream" in strings
