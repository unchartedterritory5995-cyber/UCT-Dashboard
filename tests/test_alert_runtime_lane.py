"""W5-T13 rails: a stored RUNTIME document on the alert lane.

`docs/pine/SERVER-RUNTIME-DESIGN.md` 5.1 (the `alert_user_series` and
`indicator_alert_service` rows), 5.2 (the fixed order) and 3.7 (fail closed, by name).
Arm, refuse, kill mid-life, service down -> needs attention, one request per (sym, tf)
group, the bar-time unit, the window, closed bars only, and the server stage staying off
while `PINE_RUNTIME_SERVER_STAGE` is unset.

NO NETWORK: every client the lane makes is `pine_runtime_client.PineRuntimeClient` over
`tests/fakes/pine_runtime_fake.PineRuntimeFake` (W5-T11's fake, which carries the design
3.2 digest), except the stage rail, which keeps the REAL `client_from_env` and replaces
the real transport with one that fails the test if it is ever reached.
"""
from __future__ import annotations

import base64
import re
import struct
import time
from pathlib import Path

import pytest

from api.services import alert_user_series as aus
from api.services import indicator_alert_evaluator as ev
from api.services import indicator_alert_service as ias
from api.services import indicator_compute
from api.services import pine_runtime_client as prc
from api.services import runtime_definitions as rd
from api.services import user_definitions as ud
from tests.fakes.pine_runtime_fake import FIXTURE_IDENTITY, FIXTURE_SECRET, PineRuntimeFake

ROOT = Path(__file__).resolve().parent.parent
USER = "user-rt"
DEF_ID = "u_0a1b2c3d4e5f"
DEF_B = "u_5f4e3d2c1b0a"
VALUE = f"{DEF_ID}.value"
SIGNAL = f"{DEF_ID}.signal"
T0 = 1_762_200_000
#: the REAL admission and client, captured before any fixture patches them
_REAL_SERVER_LANE_REFUSAL = rd.server_lane_refusal
_REAL_CLIENT_FROM_ENV = prc.client_from_env
SOURCE = "//@version=6\nindicator('Twice the close')\nplot(close * 2, 'value')\nplot(close, 'signal')\n"


def runtime_doc(def_id=DEF_ID, source=SOURCE, inputs=None):
    return {"schemaVersion": 1, "id": def_id, "version": 1,
            "meta": {"name": "Twice", "runtimeLanguage": "pine"},
            "compute": {"kind": "runtime", "source": source, "outputs": {"value": 0, "signal": 1}},
            "placement": {"target": "pane"},
            "plots": [{"key": "value", "style": "line"}, {"key": "signal", "style": "line"},
                      {"key": "drawn", "style": "line"}],
            "inputs": inputs or []}


def daily_bars(n=30):
    """Store-shaped DAILY bars: ``t`` is a YYYYMMDD int (`bars_sqlite`), weekdays of 2024."""
    import datetime as dt
    out, d = [], dt.date(2024, 1, 2)
    while len(out) < n:
        if d.weekday() < 5:
            c = 100.0 + len(out)
            out.append({"t": int(d.strftime("%Y%m%d")), "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1000})
        d += dt.timedelta(days=1)
    return out


class Admission:
    """`runtime_definitions.server_lane_refusal`, switchable; records every ask."""

    def __init__(self):
        self.refusal = None
        self.asked = 0

    def __call__(self, row, *, lane):
        self.asked += 1
        assert lane == "alert"
        return self.refusal


@pytest.fixture
def world(tmp_path, monkeypatch):
    path = tmp_path / "user_definitions.db"
    monkeypatch.setenv("USER_DEFINITIONS_DB_PATH", str(path))
    monkeypatch.setattr(ud, "_DB_PATH", str(path))
    ud._init_db()
    auth = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(auth))
    monkeypatch.setattr(ias, "_DB_PATH", str(auth))
    ias.init_schema()
    # the store's runtime save door (its own gates are not under test here)
    monkeypatch.setattr(rd, "save_enabled", lambda: True)
    monkeypatch.setattr(rd, "save_permission", lambda role, user_id=None: None)
    monkeypatch.setattr(rd, "not_graded", lambda source, graded_only=False: None)
    adm = Admission()
    monkeypatch.setattr(rd, "server_lane_refusal", adm)
    fake = PineRuntimeFake(now=lambda: T0)
    monkeypatch.setattr(prc, "client_from_env", lambda transport=None, identity="read": prc.PineRuntimeClient(
        url="http://pine-runtime.test", secret=FIXTURE_SECRET, identity=FIXTURE_IDENTITY,
        transport=fake, clock=lambda: T0))
    prc._forget_signing_times()
    bars = {"D": daily_bars()}
    fetched = []

    def fetch(sym, tf, count=400):
        fetched.append((sym, tf, count))
        return [dict(b) for b in bars.get(tf, daily_bars())][-int(count):]
    monkeypatch.setattr(ev, "_fetch_bars_for_alert", fetch)
    delivered, fires = [], []

    def deliver(alert, value, **k):
        delivered.append(alert["id"])
        fires.append((alert["id"], value, k.get("bar_time")))
    monkeypatch.setattr(ev, "_dispatch_delivery", deliver)
    monkeypatch.setattr(ev, "_accrue_ledger_receipt", lambda *a, **k: None)
    aus.forget()
    ud.save(USER, DEF_ID, runtime_doc(), role="admin")
    yield {"adm": adm, "fake": fake, "bars": bars, "fetched": fetched, "delivered": delivered,
           "fires": fires}
    aus.forget()
    prc._forget_signing_times()


def _wire_t(req, job=0):
    b = req["jobs"][job]["bars"]
    return list(struct.unpack("<%dd" % b["n"], base64.b64decode(b["t"])))


def _alert(indicator=VALUE, threshold=0.0, params=None, sym="AAPL", tf="D", condition="above"):
    return ias.create(user_id=USER, sym=sym, indicator=indicator, condition=condition,
                      threshold=threshold, tf=tf, params_json=params)


# ── arm ──────────────────────────────────────────────────────────────────────

def test_arm_admits_a_runtime_plot_on_one_service_run_of_the_alerts_own_bars(world):
    fake = world["fake"]
    aid = _alert()
    assert ias.get(aid)["def_source"] == ias.DEF_SOURCE_USER
    assert len(fake.calls) == 1, "the arm is ONE service run"
    req = fake.calls[0]
    assert req["profile"] == "alert" and req["definition"]["def_id"] == DEF_ID
    assert sorted(req["jobs"][0]["want"]) == ["signal", "value"]
    assert req["jobs"][0]["symbol"]["ticker"] == "AAPL" and req["jobs"][0]["tf"] == "D"
    assert req["jobs"][0]["ctx"]["newestBarIsForming"] is False
    assert req["jobs"][0]["bars"]["n"] == len(world["bars"]["D"])
    for addr in (VALUE, SIGNAL):
        fn = aus.USER_FUNCS[aus.scoped_key(USER, addr)]
        assert fn.runtime_plot == addr.split(".")[1]


def test_a_server_lane_refusal_refuses_the_arm_by_its_guard_with_no_service_call(world):
    world["adm"].refusal = ("runtime:killed", "definition `x` is on the kill list")
    with pytest.raises(aus.AdmissionRefused) as e:
        _alert()
    assert e.value.gate == "server-lane"
    assert "runtime:killed" in str(e.value) and "is on the kill list" in str(e.value)
    assert aus.REFUSAL_FRAGMENTS["server-lane"] in str(e.value)
    assert world["fake"].calls == [] and ias.list_for_user(USER) == []


def test_a_run_wide_refusal_at_arm_is_server_run_with_the_guards_sentence(world):
    world["fake"].withhold["AAPL|D|arm"] = ("runtime:limit", "the run went over its instruction budget")
    with pytest.raises(aus.AdmissionRefused) as e:
        _alert()
    assert e.value.gate == "server-run"
    assert "runtime:limit" in str(e.value) and "instruction budget" in str(e.value)
    assert ias.list_for_user(USER) == []


def test_a_per_output_refusal_refuses_that_plot_and_its_sibling_arms(world):
    world["fake"].refuse_output["signal"] = ("runtime:output", "this output is withheld")
    with pytest.raises(aus.AdmissionRefused) as e:
        _alert(indicator=SIGNAL)
    assert e.value.gate == "server-run" and "runtime:output" in str(e.value)
    assert _alert(indicator=VALUE) > 0


def test_a_service_that_is_down_refuses_the_arm_by_name(world):
    world["fake"].script_next = [ConnectionError("refused")] * 4
    with pytest.raises(aus.AdmissionRefused) as e:
        _alert()
    assert e.value.gate == "server-run" and prc.UNAVAILABLE in str(e.value)


def test_the_repaint_gate_reads_the_runtime_stamp_and_the_budget_gate_does_not_apply(world, monkeypatch):
    row = ud.get(USER, DEF_ID, None)
    monkeypatch.setattr(rd, "repaint_stamp", lambda d: {"value": "repaints", "signal": "non-repainting"})
    with pytest.raises(aus.AdmissionRefused) as e:
        aus._gate_repaint(dict(row, repaint={}), row["definition"])
    assert e.value.gate == "repaint"

    def boom(*a, **k):
        raise AssertionError("the formula budget was asked of a runtime document")
    from api.services import ast_budget
    monkeypatch.setattr(ast_budget, "check_budget", boom)
    aus._gate_budget(row["definition"], DEF_ID)


# ── the cycle: one request per group ─────────────────────────────────────────

def test_the_cycle_sends_ONE_request_for_every_runtime_alert_of_a_group(world):
    fake = world["fake"]
    a1 = _alert(VALUE, threshold=0.0)
    a2 = _alert(VALUE, threshold=1.0)
    a3 = _alert(SIGNAL, threshold=0.0)
    before = len(fake.calls)
    summary = ev._run_one_cycle()
    assert len(fake.calls) - before == 1, f"{len(fake.calls) - before} requests for one group"
    req = fake.calls[-1]
    assert len(req["jobs"]) == 1 and req["jobs"][0]["want"] == ["signal", "value"]
    last = world["bars"]["D"][-1]["c"]
    assert ias.get(a1)["last_value"] == pytest.approx(2 * last)
    assert ias.get(a3)["last_value"] == pytest.approx(last)
    assert summary["triggered"] == 3 and sorted(world["delivered"]) == sorted([a1, a2, a3])


def test_one_request_per_definition_never_one_per_alert(world):
    ud.save(USER, DEF_B, runtime_doc(DEF_B), role="admin")
    fake = world["fake"]
    for ind in (VALUE, SIGNAL, f"{DEF_B}.value", f"{DEF_B}.signal"):
        _alert(ind)
    before = len(fake.calls)
    ev._run_one_cycle()
    sent = fake.calls[before:]
    assert sorted(r["definition"]["def_id"] for r in sent) == sorted([DEF_ID, DEF_B])


def test_distinct_inputs_are_jobs_of_the_same_request(world):
    ud.save(USER, DEF_ID, runtime_doc(inputs=[{"key": "len", "type": "int", "default": 14}]),
            role="admin")
    fake = world["fake"]
    _alert(VALUE, params={"len": 14, "unrelated": "x"})
    _alert(VALUE, params={"len": 20})
    before = len(fake.calls)
    ev._run_one_cycle()
    assert len(fake.calls) - before == 1
    inputs = sorted(j["ctx"]["runtimeInputs"].get("len") for j in fake.calls[-1]["jobs"])
    assert inputs == [14, 20]
    assert all("unrelated" not in j["ctx"]["runtimeInputs"] for j in fake.calls[-1]["jobs"])


# ── kill mid-life / service down -> needs attention ─────────────────────────

def _sweep_far_ahead():
    return ias.sweep_silent_alerts(now=time.time() + 3600)


def test_a_kill_mid_life_withholds_the_next_cycle_by_name_and_deletes_nothing(world):
    fake, adm = world["fake"], world["adm"]
    aid = _alert(VALUE)
    ev._run_one_cycle()
    seen = ias.get(aid)["last_evaluated_at"]
    assert seen is not None
    adm.refusal = ("runtime:killed", "definition `u_0a1b2c3d4e5f` is on the kill list")
    before = len(fake.calls)
    summary = ev._run_one_cycle()
    assert len(fake.calls) == before, "a killed script cost a service call"
    assert summary["evaluated"] == 0
    _sweep_far_ahead()
    row = ias.get(aid)
    assert row["state"] == ias.STATE_NEEDS_ATTENTION
    assert row["state_detail"].startswith("Withheld: runtime:killed — ") and "kill list" in row["state_detail"]
    assert row["active"]
    adm.refusal = None
    ev._run_one_cycle()
    assert len(fake.calls) == before + 1 and ias.get(aid)["last_value"] is not None


def test_a_service_down_mid_life_is_needs_attention_with_the_transport_guard(world):
    fake = world["fake"]
    aid = _alert(VALUE)
    fake.script_next = [ConnectionError("down")] * 20
    summary = ev._run_one_cycle()
    assert summary["evaluated"] == 0 and world["delivered"] == []
    _sweep_far_ahead()
    row = ias.get(aid)
    assert row["state"] == ias.STATE_NEEDS_ATTENTION
    assert row["state_detail"].startswith(f"Withheld: {prc.UNAVAILABLE} — ")


def test_the_server_stage_unset_reaches_nothing(world, monkeypatch):
    """The REAL admission and the REAL client: with `PINE_RUNTIME_SERVER_STAGE` unset no
    runtime alert arms and no armed one is evaluated, and no request is ever built."""
    monkeypatch.setattr(rd, "server_lane_refusal", _REAL_SERVER_LANE_REFUSAL)
    for k in (rd.SERVER_STAGE_ENV, rd.STAGE_ENV, rd.SERVICE_URL_ENV, rd.SERVICE_SECRET_ENV, rd.KILL_ENV):
        monkeypatch.delenv(k, raising=False)
    sent = []
    monkeypatch.setattr(prc, "httpx_transport", lambda *a, **k: sent.append(a) or pytest.fail("network"))
    monkeypatch.setattr(prc, "client_from_env", _REAL_CLIENT_FROM_ENV)
    with pytest.raises(aus.AdmissionRefused) as e:
        _alert()
    assert e.value.gate == "server-lane" and "runtime:stage" in str(e.value)
    # the pane stage on, the service configured, the server stage still unset
    monkeypatch.setenv(rd.STAGE_ENV, "all")
    monkeypatch.setenv(rd.SERVICE_URL_ENV, "http://pine-runtime.test")
    monkeypatch.setenv(rd.SERVICE_SECRET_ENV, "s")
    with pytest.raises(aus.AdmissionRefused) as e:
        _alert()
    assert e.value.gate == "server-lane" and "runtime:server-stage" in str(e.value)
    assert ias.list_for_user(USER) == [] and sent == []


def test_an_armed_alert_stops_the_cycle_the_server_stage_is_unset(world, monkeypatch):
    for k in (rd.STAGE_ENV, rd.SERVER_STAGE_ENV):
        monkeypatch.setenv(k, "all")
    monkeypatch.setenv(rd.SERVICE_URL_ENV, "http://pine-runtime.test")
    monkeypatch.setenv(rd.SERVICE_SECRET_ENV, FIXTURE_SECRET)
    monkeypatch.setattr(rd, "server_lane_refusal", _REAL_SERVER_LANE_REFUSAL)
    aid = _alert()
    fake = world["fake"]
    monkeypatch.delenv(rd.SERVER_STAGE_ENV)
    before = len(fake.calls)
    summary = ev._run_one_cycle()
    assert len(fake.calls) == before and summary["evaluated"] == 0
    _sweep_far_ahead()
    assert "runtime:server-stage" in ias.get(aid)["state_detail"]


# ── bar time units, closed bars, the window ──────────────────────────────────

def test_a_daily_bar_is_sent_as_its_sessions_opening_instant(world):
    _alert()
    sent = _wire_t(world["fake"].calls[0])
    want = []
    for b in world["bars"]["D"]:
        s = str(b["t"])
        want.append(indicator_compute.bar_open_instant(f"{s[:4]}-{s[4:6]}-{s[6:]}", "D"))
    assert sent == want and all(isinstance(x, float) and x > 1e9 for x in sent)


def test_an_intraday_bar_is_sent_in_seconds_and_a_forming_bar_is_never_sent(world):
    now = time.time()
    open_now = int(now // 300) * 300
    world["bars"]["5"] = [{"t": open_now - 300 * (39 - i), "o": 10.0 + i, "h": 11.0 + i, "l": 9.0 + i,
                           "c": 10.0 + i, "v": 5} for i in range(40)]
    _alert(tf="5")
    req = world["fake"].calls[0]
    sent = _wire_t(req)
    closed = [b for b in world["bars"]["5"] if b["t"] + 300 <= now]
    assert sent == [float(b["t"]) for b in closed] and len(sent) == 39
    fn = aus.USER_FUNCS[aus.scoped_key(USER, VALUE)]
    col = fn.column(world["bars"]["5"], {}, tf="5", sym="AAPL")
    assert len(col) == 40 and col[-1] is None and col[-2] == pytest.approx(2 * closed[-1]["c"])


def test_a_bar_whose_time_cannot_be_stated_is_refused_not_guessed():
    bar = {"o": 1, "h": 1, "l": 1, "c": 1, "v": 1}
    # seconds on a date timeframe: the closed lane cannot place any bar, so nothing is sent
    assert aus.runtime_wire_bars([dict(bar, t=1_700_000_000 + 86400 * i) for i in range(3)], "D",
                                 time.time()) == ([], -1)
    with pytest.raises(aus.RuntimeBarsRefused) as e:
        aus.runtime_wire_bars([dict(bar, t=t) for t in (20240102, "not-a-date", 20240104)], "D",
                              time.time())
    assert e.value.guard == prc.INTEGRITY
    with pytest.raises(aus.RuntimeBarsRefused):
        aus.runtime_wire_bars([{"t": 20240102, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}], "5", time.time())
    with pytest.raises(aus.RuntimeBarsRefused):   # two bars stating one instant
        aus.runtime_wire_bars([dict(bar, t=1_700_000_000), dict(bar, t=1_700_000_000)], "5", time.time())


def test_the_window_is_the_profiles(world):
    _alert(tf="D")
    a = {"indicator": VALUE, "user_id": USER, "tf": "D"}
    assert aus.lookback_for_alert(a) == 5000 and ev.bars_needed_for_alert(a) == 5000
    cold = {"indicator": VALUE, "user_id": USER, "tf": "5"}
    aus.forget()
    assert aus.lookback_for_alert(cold) == 32768 and ev.bars_needed_for_alert(cold) == 32768
    assert ("AAPL", "D", 5000) in world["fetched"]
    world["bars"]["5"] = [{"t": 1_700_000_000 + 300 * i, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}
                          for i in range(50)]
    _alert(indicator=SIGNAL, tf="5")
    assert ("AAPL", "5", 32768) in world["fetched"], world["fetched"]


def test_the_intraday_window_is_the_runtimes_own_history_limit():
    text = (ROOT / "app/src/components/chart/engine/runtime/limits.js").read_text(encoding="utf-8")
    m = re.search(r"^\s*HISTORY:\s*(\d+)\s*,", text, re.M)
    assert m and int(m.group(1)) == aus.RUNTIME_WINDOW_INTRADAY


def test_a_formula_neighbour_keeps_its_own_window(world, monkeypatch):
    _alert(tf="D")
    host = {"indicator": "rsi", "user_id": USER, "tf": "D", "sym": "AAPL", "params_json": None}
    rt = {"indicator": VALUE, "user_id": USER, "tf": "D", "sym": "AAPL"}
    monkeypatch.setattr(ev, "_fetch_bars_for_alert",
                        lambda sym, tf, count=400: [{"t": i, "c": 1.0} for i in range(int(count))])
    bars, host_bars, runtime_ids = ev.group_bars("AAPL", "D", [host, rt])
    assert len(bars) == 5000 and len(host_bars) == ev.bars_needed_for_alert(host) < 5000
    assert host_bars == bars[-len(host_bars):] and runtime_ids == {id(rt)}
    only_host = ev.group_bars("AAPL", "D", [host])
    assert only_host[1] is only_host[0]


# ── edit, catalog, prefill ───────────────────────────────────────────────────

def test_an_edited_runtime_script_re_arms_on_its_new_version(world):
    fake = world["fake"]
    aid = _alert()
    ud.save(USER, DEF_ID, runtime_doc(source=SOURCE + "// edited\n"), role="admin")
    before = len(fake.calls)
    ev._run_one_cycle()
    versions = [r["definition"]["version"] for r in fake.calls[before:]]
    assert versions and set(versions) == {2}, versions
    assert ias.get(aid)["last_value"] is not None


def test_the_catalog_lists_runtime_plots_and_names_a_server_lane_refusal(world):
    entries = [e for e in aus.user_catalog(USER) if e["indicator"] == DEF_ID]
    assert [p["value"] for p in entries[0]["plots"]] == [VALUE, SIGNAL]
    world["adm"].refusal = ("runtime:server-stage", "not switched on for server runs")
    assert [e for e in aus.user_catalog(USER) if e["indicator"] == DEF_ID] == []
    [refused] = [r for r in ias.user_definition_refusals(USER) if r["id"] == DEF_ID]
    assert refused["gate"] == "server-lane" and "runtime:server-stage" in refused["messages"][0]


def test_the_prefill_value_function_lists_a_runtime_plot_and_runs_on_the_symbol(world):
    fn = aus.user_value_function(USER, VALUE)
    assert fn.runtime_plot == "value" and aus.USER_FUNCS == {}
    v = aus.call_series(fn, world["bars"]["D"], {}, tf="D", sym="AAPL")
    assert v == pytest.approx(2 * world["bars"]["D"][-1]["c"])
    from api.services import runtime_server_lane as rsl
    with pytest.raises(rsl.ServerLaneWithheld):
        fn(world["bars"]["D"], {})


def test_a_stored_engine_verdict_sends_nothing_and_names_itself(world, monkeypatch):
    fake = world["fake"]
    aid = _alert(VALUE)
    monkeypatch.setattr(ud, "engine_withheld_reason",
                        lambda row, current=None: "engine-refused: today's engine refuses it")
    before = len(fake.calls)
    assert ev._run_one_cycle()["evaluated"] == 0
    assert len(fake.calls) == before, "a held version cost a service call"
    _sweep_far_ahead()
    assert ias.get(aid)["state_detail"].startswith("Withheld: withheld — engine-refused")


def test_the_batch_never_answers_a_plot_it_did_not_ask_for():
    batch = aus.RuntimeBatch("AAPL", "D", 0.0)
    bars = [{"t": 1_700_000_000.0 + i, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1.0} for i in range(3)]
    asked = prc.Job(job="a", ticker="AAPL", tf="D", bars=bars, want=("value",))
    res = prc.JobResult(job="a", status="ok", columns={"value": (1.0, 2.0, 3.0)})
    batch.results[aus.RuntimeBatch.key(DEF_ID, 1, asked)] = ({"value"}, res)
    assert batch.lookup(DEF_ID, 1, asked) is res
    other = prc.Job(job="b", ticker="AAPL", tf="D", bars=bars, want=("signal",))
    assert batch.lookup(DEF_ID, 1, other) is None
    assert batch.lookup(DEF_ID, 2, asked) is None


# ── FIX r1 ───────────────────────────────────────────────────────────────────

def _warm_up_script(k):
    """The engine's own warm-up shape: na (NaN) on the first ``k`` bars, then 2 * close."""
    def script(cols):
        c = cols["c"]
        return {"value": [float("nan") if i < k else 2.0 * x for i, x in enumerate(c)],
                "signal": [float("nan") if i < k else x for i, x in enumerate(c)]}
    return script


def test_a_warm_up_bar_is_never_fired_on_prefilled_or_used_as_previous(world):
    """B1 (review r1) at the ALERT level. The run's first `withheldBars` bars are na (the
    engine NaNs them; T11 r2 refuses a finite one): such a bar is never the value fired on,
    never the prefill and never the "previous" a crossing is judged from."""
    fake, bars = world["fake"], world["bars"]["D"]
    n = len(bars)
    fake.script = _warm_up_script(n)
    fake.withheld_bars = n                       # every closed bar is warm-up
    a_all = _alert(VALUE, threshold=0.0)
    ev._run_one_cycle()
    assert world["fires"] == [] and ias.get(a_all)["last_value"] is None
    assert aus.call_series(aus.user_value_function(USER, VALUE), bars, {}, tf="D", sym="AAPL") is None
    fn = aus.USER_FUNCS[aus.scoped_key(USER, VALUE)]
    assert fn.column(bars, {}, tf="D", sym="AAPL") == [None] * n
    ias.delete(a_all)
    # the newest bar answers and the one before it is warm-up: a crossing a leaked
    # "previous" would fire (prev < threshold < current) must not fire
    fake.script = _warm_up_script(n - 1)
    fake.withheld_bars = n - 1
    threshold = 2 * bars[-2]["c"] + 1.0
    a_cross = _alert(VALUE, threshold=threshold, condition="cross_above")
    ev._run_one_cycle()
    col = fn.column(bars, {}, tf="D", sym="AAPL")
    assert col[:-1] == [None] * (n - 1) and col[-1] == pytest.approx(2 * bars[-1]["c"])
    assert [f for f in world["fires"] if f[0] == a_cross] == []


def test_a_finite_warm_up_value_never_reaches_the_alert(world):
    """B1, the other half: a column whose warm-up bars carry FINITE numbers is refused by the
    client (T11 r2: `runtime:server-integrity`), so the alert neither fires nor prefills, and
    the silent-alert sweep names the guard."""
    fake, bars = world["fake"], world["bars"]["D"]
    aid = _alert(VALUE, threshold=0.0)           # armed on an honest run
    # a reply whose warm-up covers bars that carry finite values (the engine would have
    # blanked them; the fake does, so the reply is edited after the run)
    def finite_warm_up(reply):
        for r in reply["results"]:
            r["warmup"] = {"withheldBars": 5}
        return reply
    fake.tamper = finite_warm_up
    assert ev._run_one_cycle()["evaluated"] == 0 and world["fires"] == []
    _sweep_far_ahead()
    assert ias.get(aid)["state_detail"].startswith(f"Withheld: {prc.INTEGRITY} — ")
    from api.services import runtime_server_lane as rsl
    with pytest.raises(rsl.ServerLaneWithheld) as e:
        aus.call_series(aus.user_value_function(USER, VALUE), bars, {}, tf="D", sym="AAPL")
    assert e.value.guard == prc.INTEGRITY


@pytest.mark.parametrize("refusal", [
    ("runtime:killed", "definition `u_0a1b2c3d4e5f` is on the kill list"),
    ("runtime:server-stage", "not switched on for server runs for this account right now"),
    ("runtime:not-yet-graded", "this script has not yet been graded against TradingView"),
])
def test_the_cycle_asks_the_one_public_admission_and_sends_nothing_it_refuses(world, refusal):
    from api.services import runtime_server_lane as rsl
    aid = _alert(VALUE)
    world["adm"].refusal = refusal
    row = ud.get(USER, DEF_ID, None)
    assert rsl.admission(row, "value", "alert") == refusal
    before = len(world["fake"].calls)
    assert ev._run_one_cycle()["evaluated"] == 0
    assert len(world["fake"].calls) == before
    _sweep_far_ahead()
    assert ias.get(aid)["state_detail"].startswith(f"Withheld: {refusal[0]} — ")


def test_a_runtime_plot_is_judged_on_the_closed_lane_even_under_the_forming_rollback(world, monkeypatch):
    """Desktop ruling (review note N1): under `ALERT_EVAL_MODE=forming` a runtime alert still
    takes the closed lane, so a fire's value and its `bar_time` name the same (closed) bar."""
    monkeypatch.setenv(ev.ALERT_EVAL_MODE_ENV, "forming")
    assert ev.eval_mode() == "forming"
    now = time.time()
    open_now = int(now // 300) * 300
    world["bars"]["5"] = [{"t": open_now - 300 * (39 - i), "o": 10.0 + i, "h": 11.0 + i, "l": 9.0 + i,
                           "c": 10.0 + i, "v": 5} for i in range(40)]
    aid = _alert(tf="5")
    ev._run_one_cycle()
    closed = world["bars"]["5"][-2]
    [(fid, value, bar_time)] = world["fires"]
    assert fid == aid and value == pytest.approx(2 * closed["c"])
    assert bar_time == closed["t"], (bar_time, closed["t"], world["bars"]["5"][-1]["t"])
