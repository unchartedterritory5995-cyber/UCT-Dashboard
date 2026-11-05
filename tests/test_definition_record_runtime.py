"""W5-T16 rails: `definition_record.record_runtime_pass` (design 5.1).

The runtime-lane twin of `record_pass`. `def_hash` is DERIVED from the stored runtime document;
the warm-up pad is the RUN's (`column.warmup`), never guessed; the forward-only origin rule is
`record_evaluation`'s, unchanged. NO NETWORK: runs go through a fake column function, or through
`tests/fakes/pine_runtime_fake.PineRuntimeFake` behind the real client and lane adapter.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import definition_record as dr
from api.services import pine_runtime_client as prc
from api.services import runtime_definitions, user_definitions
from api.services import runtime_server_lane as lane_mod
from api.services.signature import ledger
from tests.fakes.pine_runtime_fake import FIXTURE_IDENTITY, FIXTURE_SECRET, PineRuntimeFake

T0 = 1_762_200_000
SOURCE = "//@version=6\nindicator('x')\nplot(close)"


def _row(source=SOURCE):
    return {"def_id": "u_0123456789ab", "version": 3, "user_id": "user-42",
            "definition": {"id": "u_0123456789ab", "meta": {},
                           "compute": {"kind": "runtime", "source": source, "outputs": ["value"]}}}


ROW = _row()
HASH = runtime_definitions.handle(ROW["definition"])


def _bars(n, start=T0, step=86_400):
    return [{"t": start + i * step, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10} for i in range(n)]


class Col(list):
    """A lane column that carries the run's warm-up, as the protocol will report it."""
    warmup = None


def col(values, warmup):
    c = Col(values)
    c.warmup = warmup
    return c


def fn_returning(column):
    return lambda bars, params, *, tf, ticker: column


@pytest.fixture
def store(tmp_path, monkeypatch):
    p = tmp_path / "signal_ledger.db"
    monkeypatch.setenv("SIGNAL_LEDGER_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_DB_PATH", str(p))
    monkeypatch.setattr(ledger, "_INITED", False)
    monkeypatch.setattr(dr, "_INITED", set())
    return p


def rows(path):
    with sqlite3.connect(str(path)) as c:
        try:
            return c.execute(f"SELECT def_hash, rev, tf, sym, first_bar_time, through_bar_time, "
                             f"bars_evaluated, bars_true FROM {dr.TABLE_NAME} ORDER BY id").fetchall()
        except sqlite3.OperationalError:
            return []


def run(bars, column, *, row=ROW, rev=1, sym="AAA", tf="1D"):
    return dr.record_runtime_pass(rev, tf, sym, row=row, plot_key="value", bars=bars,
                                  column_fn=fn_returning(column), at=1_700_100_000.0)


def test_records_with_the_runs_own_warmup_pad(store):
    bars = _bars(10)
    values = [0.0, 0.0, 0.0, 1.0, 0.0, 2.0, 1.0, 0.0, 1.0, 1.0]
    out = run(bars, col(values, {"withheldBars": 3}))
    assert out["recorded"] is True and out["skipped"] is None
    assert (out["evaluated"], out["true"]) == (7, 5)
    assert out["first_bar_time"] == bars[3]["t"] and out["through_bar_time"] == bars[9]["t"]
    assert rows(store) == [(HASH, 1, "1D", "AAA", bars[3]["t"], bars[9]["t"], 7, 5)]


def test_the_pad_is_the_runs_not_a_constant(store):
    bars = _bars(10)
    values = [1.0] * 10
    a = run(bars, col(values, {"withheldBars": 2}), sym="AAA")
    b = run(bars, col(values, {"withheldBars": 6}), sym="BBB")
    assert (a["evaluated"], b["evaluated"]) == (8, 4)
    assert a["first_bar_time"] == bars[2]["t"] and b["first_bar_time"] == bars[6]["t"]


def test_zero_warmup_counts_every_computable_bar(store):
    out = run(_bars(4), col([1.0, 0.0, 1.0, 1.0], {"withheldBars": 0}))
    assert (out["evaluated"], out["true"]) == (4, 3)


def test_na_and_none_and_inf_inside_the_region_are_not_evaluations(store):
    nan = float("nan")
    out = run(_bars(6), col([nan, None, 1.0, float("inf"), 0.0, nan], {"withheldBars": 1}))
    assert (out["evaluated"], out["true"]) == (2, 1)


def test_def_hash_is_derived_from_the_stored_document_never_accepted(store):
    bars = _bars(5)
    with pytest.raises(TypeError):
        dr.record_runtime_pass(1, "1D", "AAA", row=ROW, plot_key="value", bars=bars,
                               def_hash="sha256:" + "0" * 64,
                               column_fn=fn_returning(col([1.0] * 5, {"withheldBars": 0})))
    a = run(bars, col([1.0] * 5, {"withheldBars": 0}))
    b = run(bars, col([1.0] * 5, {"withheldBars": 0}), row=_row(SOURCE + "\n// edited"))
    assert a["def_hash"] == HASH and b["def_hash"] != a["def_hash"]
    assert {r[0] for r in rows(store)} == {a["def_hash"], b["def_hash"]}


def test_a_run_with_no_warmup_is_refused_never_guessed(store):
    out = run(_bars(5), [1.0] * 5)   # a plain list: the shipped lane's answer today
    assert out["recorded"] is False and out["skipped"].startswith(dr.RUNTIME_WARMUP_GUARD)
    assert rows(store) == []


@pytest.mark.parametrize("warm", [None, {}, {"withheldBars": True}, {"withheldBars": -1},
                                  {"withheldBars": 6}, {"withheldBars": 1.5}, {"withheldBars": "2"},
                                  {"shift": 0}, 3])
def test_a_malformed_warmup_is_refused(store, warm):
    out = run(_bars(5), col([1.0] * 5, warm))
    assert out["recorded"] is False and out["skipped"].startswith(dr.RUNTIME_WARMUP_GUARD)
    assert rows(store) == []


def test_forward_only_origin_still_enforced(store):
    late = _bars(5, start=T0 + 100 * 86_400)
    early = _bars(5, start=T0)
    assert run(late, col([1.0] * 5, {"withheldBars": 0}))["recorded"] is True
    with pytest.raises(ValueError, match=dr.REFUSALS["before_origin"]):
        run(early, col([1.0] * 5, {"withheldBars": 0}))
    assert len(rows(store)) == 1
    later = _bars(5, start=T0 + 200 * 86_400)
    assert run(later, col([1.0] * 5, {"withheldBars": 0}))["recorded"] is True
    assert run(later, col([1.0] * 5, {"withheldBars": 0}))["recorded"] is False
    assert len(rows(store)) == 2


def test_a_withheld_lane_records_nothing_and_says_why(store):
    def fn(bars, params, *, tf, ticker):
        raise lane_mod.ServerLaneWithheld("runtime:killed", "this script is switched off")
    out = dr.record_runtime_pass(1, "1D", "AAA", row=ROW, plot_key="value", bars=_bars(5), column_fn=fn)
    assert out["recorded"] is False and out["skipped"] == "runtime:killed: this script is switched off"
    assert rows(store) == []


def test_a_row_that_is_not_a_runtime_document_is_refused(store):
    ast_row = {"def_id": "u_0123456789ab", "definition": {"compute": {"kind": "ast", "ast": {}}}}
    with pytest.raises(ValueError, match=dr.RUNTIME_REFUSALS["not_runtime"]):
        run(_bars(3), col([1.0] * 3, {"withheldBars": 0}), row=ast_row)


def test_a_column_that_is_not_one_value_per_bar_is_refused(store):
    with pytest.raises(ValueError, match=dr.RUNTIME_REFUSALS["column_shape"]):
        run(_bars(5), col([1.0] * 4, {"withheldBars": 0}))
    with pytest.raises(ValueError, match=dr.RUNTIME_REFUSALS["column_shape"]):
        run(_bars(5), "11111")


def test_no_computable_bar_writes_nothing(store):
    nan = float("nan")
    out = run(_bars(3), col([nan, nan, nan], {"withheldBars": 0}))
    assert out["recorded"] is False and out["skipped"] == "no bar in this window was computable"
    assert rows(store) == []


def test_the_timeframe_key_is_still_the_product_label(store):
    with pytest.raises(ValueError, match="bars-store code for '1D'"):
        run(_bars(3), col([1.0] * 3, {"withheldBars": 0}), tf="D")


def test_runtime_refusal_phrases_are_distinct_from_every_other_in_the_module():
    mine = dr.RUNTIME_REFUSALS
    others = list(dr.REFUSALS.values())
    for k, p in mine.items():
        for q in others + [v for kk, v in mine.items() if kk != k]:
            assert p not in q and q not in p


# --- through the real client + lane adapter, fake service (NO NETWORK) ---------------------------

@pytest.fixture
def lane(monkeypatch):
    prc._forget_signing_times()
    verdict = {"v": None}
    monkeypatch.setattr(user_definitions, "engine_withheld_reason", lambda row, current=None: verdict["v"])
    monkeypatch.setattr(runtime_definitions, "server_lane_refusal", lambda row, *, lane: None, raising=False)
    fake = PineRuntimeFake()
    make = lambda: prc.PineRuntimeClient(url="http://pine-runtime.test", secret=FIXTURE_SECRET,  # noqa: E731
                                         identity=FIXTURE_IDENTITY, transport=fake, clock=lambda: T0)
    yield verdict, fake, make
    prc._forget_signing_times()


def _bars_n(n):
    return [{"t": T0 + i * 86_400, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.0 + i, "v": 10} for i in range(n)]


def test_the_real_lane_records_with_the_runs_own_warmup(store, lane):
    """End to end through the real client, lane adapter and the T11 fake: the fake's run withholds
    k bars (NaN in [0,k)); the pass records evaluated == n-k from bar k."""
    _, fake, make = lane
    k, n = 3, 8
    fake.withheld_bars = k
    fake.script = lambda cols: {"value": [float("nan")] * k + [1.0] * (n - k)}
    fn = lane_mod.runtime_column_fn(ROW, "value", "record", client_factory=make)
    bars = _bars_n(n)
    out = dr.record_runtime_pass(1, "1D", "AAA", row=ROW, plot_key="value", bars=bars, column_fn=fn)
    assert fake.calls[0]["profile"] == "record"
    assert out["recorded"] is True and (out["evaluated"], out["true"]) == (n - k, n - k)
    assert out["first_bar_time"] == bars[k]["t"]
    assert rows(store) == [(HASH, 1, "1D", "AAA", bars[k]["t"], bars[-1]["t"], n - k, n - k)]


@pytest.mark.parametrize("label", sorted(ledger._PRODUCT_TIMEFRAMES))
def test_the_service_is_asked_in_the_bars_store_code_not_the_record_label(store, lane, label):
    _, fake, make = lane
    fn = lane_mod.runtime_column_fn(ROW, "value", "record", client_factory=make)
    dr.record_runtime_pass(1, label, "AAA", row=ROW, plot_key="value", bars=_bars_n(4), column_fn=fn)
    sent = fake.calls[0]["jobs"][0]["tf"]
    assert ledger._BARS_STORE_TF_KEYS[sent] == label
    assert sent in ledger._BARS_STORE_TF_KEYS and (label != "1D" or sent == "D")


def test_every_record_label_has_exactly_one_code():
    for label in ledger._PRODUCT_TIMEFRAMES:
        code = dr._service_tf(label)
        assert ledger._BARS_STORE_TF_KEYS[code] == label


def test_the_runtime_record_key_is_the_scan_lanes_handle(store):
    assert HASH.startswith(runtime_definitions.HASH_PREFIX)
    out = run(_bars(3), col([1.0] * 3, {"withheldBars": 0}))
    assert out["def_hash"] == runtime_definitions.handle(ROW["definition"]) == HASH
    assert dr.origin(HASH, 1) is not None


def test_a_withheld_verdict_through_the_real_lane_records_nothing(store, lane):
    verdict, fake, make = lane
    verdict["v"] = "engine-refused: test"
    fn = lane_mod.runtime_column_fn(ROW, "value", "record", client_factory=make)
    out = dr.record_runtime_pass(1, "1D", "AAA", row=ROW, plot_key="value", bars=_bars(5), column_fn=fn)
    assert out["recorded"] is False and out["skipped"].startswith("withheld: ")
    assert fake.calls == [] and rows(store) == []


def test_default_lane_is_the_record_profile(store, monkeypatch):
    seen = {}

    def fake_cf(row, plot_key, lane_name, **kw):
        seen["args"] = (plot_key, lane_name)
        return fn_returning(col([1.0] * 3, {"withheldBars": 0}))
    monkeypatch.setattr(lane_mod, "runtime_column_fn", fake_cf)
    out = dr.record_runtime_pass(1, "1D", "AAA", row=ROW, plot_key="value", bars=_bars(3))
    assert seen["args"] == ("value", "record") and out["recorded"] is True


def test_one_authority_per_key_shape():
    """The tree shape is user_definitions' (the same object, not a copy); the runtime shape is derived
    from runtime_definitions.HASH_PREFIX, and a key is admitted by exactly those two."""
    assert dr._HASH_RE is user_definitions.RESULT_IDENTITY_RE
    h64 = "ab" * 32
    assert dr._key_shape_ok("sha256:" + h64) and dr._key_shape_ok("sha256:" + h64 + "~s2")
    assert dr._key_shape_ok(runtime_definitions.HASH_PREFIX + h64)
    for bad in ("", "nope", "runtime:" + h64, runtime_definitions.HASH_PREFIX + "ab",
                runtime_definitions.HASH_PREFIX + h64 + "~s2", "x" + runtime_definitions.HASH_PREFIX + h64, None, 5):
        assert not dr._key_shape_ok(bad), bad


def test_a_malformed_runtime_key_is_refused_by_the_shared_door():
    with pytest.raises(ValueError, match=dr.REFUSALS["def_hash_shape"]):
        dr.record_evaluation(runtime_definitions.HASH_PREFIX + "ab", 1, "1D", "A", 1, 2, bars_evaluated=1, bars_true=0)
