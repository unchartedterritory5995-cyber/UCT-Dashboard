"""SETTINGS PARITY (timeframe, Engine 77, #1831): an alert on a runtime document runs its author's timeframe only.

A runtime document declares its `input.timeframe` as a setting ON LOAD (`runtime/runtimeInputs.js::
withTimeframeInputs`, never stored), so this lane, which reads the STORED document, has no declared key
for it and would compute the author's timeframe. An alert whose timeframe setting is moved is therefore
withheld by name (`alert_user_series.runtime_timeframe_moved`), never computed at another timeframe.
Each rail has a control.
"""
from __future__ import annotations

import pytest

from api.services import alert_user_series as aus
from api.services import pine_runtime_client as prc
from api.services import runtime_server_lane as rsl

PA_ZIGZAG = (
    "//@version=6\nindicator('PA ZigZag', 'F', true)\n"
    "bool useAltTF = input.bool(true, title='Use Alt Timeframe?')\n"
    "string tf = input.timeframe('1D', 'Alt Timeframe')\n"
    "plot(request.security(syminfo.tickerid, tf, close))\n"
)
V4 = (
    "//@version=4\nstudy('x')\n"
    "res = input('W', title='Res', type=input.resolution)\n"
    "r2 = input(defval='', type=resolution)\n"
    "len = input(14, type=input.integer)\n"
    "plot(close)\n"
)


def _defn(source):
    return {"compute": {"kind": "runtime", "source": source, "outputs": {"value": 0}},
            "plots": [{"key": "value"}], "inputs": []}


def _row(source):
    return {"def_id": "u_tf", "user_id": "user-tf", "version": 1, "definition": _defn(source)}


def _bars(n=60):
    return [{"t": 20250102 + i, "o": 100.0 + i, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1000}
            for i in range(n)]


def test_T1_the_reader_names_every_timeframe_input_and_its_default():
    assert aus.runtime_timeframe_inputs(_defn(PA_ZIGZAG)) == {"tf": "1D"}
    assert aus.runtime_timeframe_inputs(_defn(V4)) == {"res": "W", "r2": ""}
    # CONTROL: no timeframe input, nothing named; a non-literal default is named with no default
    assert aus.runtime_timeframe_inputs(_defn("//@version=6\nindicator('x')\nplot(close)\n")) == {}
    assert aus.runtime_timeframe_inputs(_defn("//@version=6\nindicator('x')\ntf = input.timeframe(timeframe.period)\n")) \
        == {"tf": None}


def test_T2_a_moved_timeframe_is_withheld_by_name_and_the_default_is_not():
    why = aus.runtime_timeframe_moved(_defn(PA_ZIGZAG), {"tf": "1W"})
    assert why is not None and "tf is set to 1W" in why and "(1D)" in why
    # CONTROL: the default, an absent key, an unrelated key
    assert aus.runtime_timeframe_moved(_defn(PA_ZIGZAG), {"tf": "1D"}) is None
    assert aus.runtime_timeframe_moved(_defn(PA_ZIGZAG), {}) is None
    assert aus.runtime_timeframe_moved(_defn(PA_ZIGZAG), {"useAltTF": False}) is None
    # a non-literal default: any value given is moved
    nonlit = _defn("//@version=6\nindicator('x')\ntf = input.timeframe(timeframe.period)\n")
    assert aus.runtime_timeframe_moved(nonlit, {"tf": "1D"}) is not None


class _Recorder:
    """A runtime client that records every job it is handed and refuses each one (no network)."""

    def __init__(self):
        self.jobs = []

    def run(self, *, jobs, **kw):
        self.jobs.extend(jobs)
        return [prc.JobResult(job=j.job, status="withheld", refusals=(
            prc.Refusal("*", "runtime:limit", "the run went over its instruction budget"),)) for j in jobs]


def test_T3_arming_with_a_moved_timeframe_refuses_by_name_before_any_run(monkeypatch):
    rec = _Recorder()
    monkeypatch.setattr(aus, "_runtime_client", lambda: rec)
    row = _row(PA_ZIGZAG)
    with pytest.raises(aus.AdmissionRefused) as moved:
        aus._gate_runtime_service(row, row["definition"], "u_tf", _bars(), sym="SPY", tf="D", params={"tf": "1W"})
    assert moved.value.runtime_guard == aus.TIMEFRAME_SETTING_GUARD
    assert rec.jobs == []
    # CONTROL: at the default the run is asked (and its own refusal comes back, by its own name)
    with pytest.raises(aus.AdmissionRefused) as default:
        aus._gate_runtime_service(row, row["definition"], "u_tf", _bars(), sym="SPY", tf="D", params={"tf": "1D"})
    assert default.value.runtime_guard == "runtime:limit"
    assert len(rec.jobs) == 1


def test_T4_a_cycle_value_with_a_moved_timeframe_is_withheld_by_name(monkeypatch):
    asked = []
    monkeypatch.setattr(rsl, "runtime_column_fn", lambda *a, **k: asked.append(a) or (lambda *x, **y: []))
    row = _row(PA_ZIGZAG)
    fn = aus._make_runtime_value_fn(row, "u_tf", "value", row["definition"])
    with pytest.raises(rsl.ServerLaneWithheld) as moved:
        fn.column(_bars(), {"tf": "1M"}, tf="D", sym="SPY")
    assert moved.value.guard == aus.TIMEFRAME_SETTING_GUARD
    assert asked == []
    # CONTROL: at the default the run is asked
    try:
        fn.column(_bars(), {"tf": "1D"}, tf="D", sym="SPY")
    except Exception:                                    # noqa: BLE001 - the stub's empty column is not ours
        pass
    assert len(asked) == 1
