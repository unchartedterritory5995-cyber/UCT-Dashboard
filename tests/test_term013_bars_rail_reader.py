"""TERM-013 / FB-OBS-02 - read the push-rail drop counters on a schedule.

Spec: `docs/terminal-research/10-roadmap/backlog.md`, "#### TERM-013", and
`observability-plan.md` rows S1 (push-rail silence -> PAGE) and S2 (drop
accumulation -> DIGEST), OBS-2's thresholds:

    "Any delta bars_dropped_total -> DIGEST. bars_emitted_total flat across 3
     consecutive 60 s RTH polls with subscriber_pairs > 0 -> PAGE."

The ticket's three acceptance criteria, each a section below with a control:

  (a) The decision function returns PAGE on the flat-emitted-with-subscribers
      fixture and DIGEST on any positive drop delta, both seen red first.
  (b) The AST rail finds the job in the scheduler AND has a non-vacuity control.
  (c) A simulated redeploy mid-window does not produce a spurious PAGE.

NO TEST HERE READS THE WALL CLOCK. Every `now` is injected, and so is every
"is the market in session" answer - a test that reads the clock is a function of
the hour it runs in.
"""
from __future__ import annotations

import ast
import datetime as dt
import importlib.util
import json
import pathlib
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_rail_monitor as brm
from api.services import cadence_heartbeat as ch

_REPO = pathlib.Path(__file__).resolve().parents[1]
_ET = ZoneInfo("America/New_York")
_TOOL = _REPO / "tools" / "cadence_rollup_report.py"
_AUDIT = _REPO / "api" / "services" / "bars_continuous_audit.py"
_MON_SRC = _REPO / "api" / "services" / "bars_rail_monitor.py"

OLD = "a" * 32          # the process before a redeploy
NEW = "b" * 32          # the process after it


def _et(y, mo, d, h=10, mi=0, s=0) -> float:
    return dt.datetime(y, mo, d, h, mi, s, tzinfo=_ET).timestamp()


T0 = _et(2026, 9, 28, 10, 0)      # a Monday, inside RTH


def _load(path: pathlib.Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _payload(emitted, dropped=0, subs=3, *, enabled=True):
    if not enabled:
        return {"enabled": False}
    return {"enabled": True,
            "broadcaster": {"subscriber_pairs": subs, "bars_emitted_total": emitted,
                            "bars_dropped_total": dropped, "last_emit_age_s": 1.0}}


def _obs(emitted, dropped=0, subs=3, *, token=OLD, now=T0):
    return brm.observe(_payload(emitted, dropped, subs), token=token, now=now)


def _run(readings, *, in_session=True):
    """Feed (emitted, dropped, subs, token) readings through `decide`; return verdicts."""
    state = brm.initial_state()
    out = []
    for i, (e, d, s, tok) in enumerate(readings):
        state, v = brm.decide(state, _obs(e, d, s, token=tok, now=T0 + 60 * i),
                              in_session=in_session)
        out.append(v)
    return out


# ═══════════════════════════════════════════════ observe: what one poll SAYS

def test_observe_reads_the_shipped_routes_fields():
    o = _obs(100, 4, 2)
    assert (o["kind"], o["emitted"], o["dropped"], o["subs"]) == (brm.OK, 100, 4, 2)


def test_observe_rail_OFF_is_its_own_state_not_a_fault_and_not_zero():
    o = brm.observe({"enabled": False}, token=OLD, now=T0)
    assert o["kind"] == brm.OFF and o["emitted"] is None


def test_observe_a_broadcaster_error_is_UNREADABLE_with_its_reason_never_zero():
    o = brm.observe({"enabled": True, "broadcaster_error": "boom"}, token=OLD, now=T0)
    assert o["kind"] == brm.UNREADABLE and "boom" in o["reason"]
    assert o["emitted"] is None, "a layer that could not be READ is not a layer that is EMPTY"
    o2 = brm.observe({"enabled": True, "broadcaster": {"subscriber_pairs": 1}},
                     token=OLD, now=T0)
    assert o2["kind"] == brm.UNREADABLE
    o3 = brm.observe("not a dict", token=OLD, now=T0)
    assert o3["kind"] == brm.UNREADABLE


# ═══════════════════════════════ (a) PAGE on flat-with-subscribers, DIGEST on drops

def test_A_PAGE_when_emitted_is_flat_across_3_polls_with_subscribers():
    """Four readings = three flat polls. The third flat poll pages; the second does not."""
    v = _run([(500, 0, 3, OLD)] * 4)
    assert [x["page"] for x in v] == [False, False, False, True]
    assert v[-1]["flat_polls"] == 3


def test_A_CONTROL_an_advancing_rail_never_pages():
    v = _run([(500 + 10 * i, 0, 3, OLD) for i in range(8)])
    assert not any(x["page"] for x in v)
    assert all(x["flat_polls"] == 0 for x in v)


def test_A_CONTROL_flat_with_NO_subscribers_is_not_a_page():
    """Nobody watching a chart = nothing to emit. Silence is only a fault with an audience."""
    v = _run([(500, 0, 0, OLD)] * 6)
    assert not any(x["page"] for x in v)


def test_A_CONTROL_flat_OUTSIDE_the_session_is_not_a_page():
    v = _run([(500, 0, 3, OLD)] * 6, in_session=False)
    assert not any(x["page"] for x in v)


def test_A_one_advancing_poll_RESTARTS_the_flat_count():
    v = _run([(500, 0, 3, OLD)] * 3 + [(501, 0, 3, OLD)] + [(501, 0, 3, OLD)] * 2)
    assert not any(x["page"] for x in v), [x["flat_polls"] for x in v]


def test_A_DIGEST_on_ANY_positive_drop_delta():
    v = _run([(500, 7, 3, OLD), (510, 8, 3, OLD)])
    assert v[1]["digest"] is True and v[1]["drop_delta"] == 1


def test_A_CONTROL_no_drop_delta_is_no_digest():
    v = _run([(500, 7, 3, OLD), (510, 7, 3, OLD)])
    assert v[1]["digest"] is False and v[1]["drop_delta"] == 0


def test_A_a_DROP_is_never_a_PAGE():
    """The severity inversion item 16 names: paging on drops trains the channel to be
    ignored. A rail dropping heavily while it EMITS is conflation, not a dead rail."""
    v = _run([(500 + 10 * i, 100 * i, 3, OLD) for i in range(6)])
    assert any(x["digest"] for x in v)
    assert not any(x["page"] for x in v)


def test_an_UNREADABLE_poll_is_not_a_confirm_and_does_not_lose_the_baseline():
    state = brm.initial_state()
    state, _ = brm.decide(state, _obs(500, 3), in_session=True)
    state, v = brm.decide(state, brm.observe({"enabled": True, "broadcaster_error": "x"},
                                             token=OLD, now=T0 + 60), in_session=True)
    assert v["page"] is False and v["flat_polls"] == 0 and v["drop_delta"] == 0
    state, v = brm.decide(state, _obs(520, 5, now=T0 + 120), in_session=True)
    assert v["drop_delta"] == 2, "drops across an unreadable gap are counted once, not lost"


# ═══════════════════════════════════════════ (c) a redeploy is not a dead rail

def test_C_a_redeploy_mid_window_does_not_produce_a_spurious_PAGE():
    """INST-3: the counters are per-process and reset to 0 by every deploy. Two flat
    polls in the old process, then the new process answers with LOWER totals. A reader
    that compared totals across the deploy would call that 'not advancing' and page."""
    v = _run([(90_000, 50, 3, OLD)] * 3            # two flat polls in the old process
             + [(12, 0, 3, NEW), (40, 0, 3, NEW), (75, 0, 3, NEW)])
    assert v[2]["flat_polls"] == 2
    assert not any(x["page"] for x in v), [x["flat_polls"] for x in v]
    assert v[3]["flat_polls"] == 0, "a new process has no history to be flat against"


def test_C_a_redeploy_restarts_the_count_even_when_both_processes_read_the_SAME_total():
    """The trap in its sharpest form: the old pod was flat at 0 and the new pod also
    reads 0. Equal totals from two processes are two unrelated numbers."""
    v = _run([(0, 0, 3, OLD)] * 3 + [(0, 0, 3, NEW)])
    assert [x["flat_polls"] for x in v] == [0, 1, 2, 0]
    assert not any(x["page"] for x in v)


def test_C_the_new_process_pages_on_its_OWN_three_flat_polls():
    """CONTROL: the redeploy guard must not make a genuinely dead rail after a deploy
    unpageable - the new process's own flat streak still pages."""
    v = _run([(90_000, 0, 3, OLD)] * 2 + [(0, 0, 3, NEW)] * 4)
    assert v[-1]["page"] is True


def test_C_drops_across_a_redeploy_are_the_new_process_since_boot_total_never_negative():
    v = _run([(90_000, 50, 3, OLD), (90_100, 55, 3, OLD), (30, 2, 3, NEW)])
    assert v[1]["drop_delta"] == 5
    assert v[2]["drop_delta"] == 2, "the new counter began at 0 at its boot"
    assert v[2]["emitted_delta"] == 30


# ══════════════════════════════════════ poll_once: the flag, the sink, the ledger

class _Sink:
    def __init__(self):
        self.calls = []

    def emit(self, key, severity, message, metadata=None):
        self.calls.append((key, severity, message, metadata))
        return True


@pytest.fixture
def rig(tmp_path, monkeypatch):
    """A poll loop with every input injected: the route read, the clock, the session,
    the process token, the sink, the ledger and the heartbeat directory."""
    monkeypatch.setenv(ch.MARKER_DIR_ENV, str(tmp_path / "cadence"))
    monkeypatch.delenv(brm.FLAG, raising=False)
    from api.services import chart_health_alerts as cha
    real_emit = cha.emit
    sink = _Sink()
    monkeypatch.setattr(cha, "emit", sink.emit)
    brm.reset_state()
    readings = []

    def poll(emitted, dropped=0, subs=3, *, token=OLD, i=0, in_session=True, payload=None):
        p = payload if payload is not None else _payload(emitted, dropped, subs)
        return brm.poll_once(now=T0 + 60 * i, read=lambda: p, token=token,
                             in_session=in_session, base_dir=str(tmp_path / "rail"))

    yield type("Rig", (), {"poll": staticmethod(poll), "sink": sink,
                           "real_emit": staticmethod(real_emit),
                           "rail": str(tmp_path / "rail"), "tmp": tmp_path,
                           "readings": readings})
    brm.reset_state()


def test_the_PAGE_is_DARK_until_its_flag_is_set_but_the_verdict_is_still_recorded(rig):
    for i in range(4):
        v = rig.poll(500, i=i)
    assert v["page"] is True and v["paged"] is False
    assert rig.sink.calls == [], "a dark page must emit nothing"
    day, err = brm.read_day("2026-09-28", base_dir=rig.rail)
    assert err is None and day["page_verdicts"] == 1 and day["pages_emitted"] == 0


def test_CONTROL_with_the_flag_set_a_PAGE_reaches_the_ops_sink_as_CRITICAL(rig, monkeypatch):
    monkeypatch.setenv(brm.FLAG, "1")
    for i in range(4):
        v = rig.poll(500, i=i)
    assert v["paged"] is True
    assert len(rig.sink.calls) == 1
    key, severity, message, meta = rig.sink.calls[0]
    assert key == brm.ALERT_KEY and severity == "critical"
    assert "500" in message and meta["subscriber_pairs"] == 3


def test_a_redeploy_through_the_LOOP_pages_nobody_even_with_the_flag_set(rig, monkeypatch):
    """(c) again, one level up: through `poll_once`, the path the thread runs."""
    monkeypatch.setenv(brm.FLAG, "1")
    for i in range(3):
        rig.poll(90_000, i=i, token=OLD)
    v = rig.poll(12, i=3, token=NEW)
    v = rig.poll(12, i=4, token=NEW)
    assert rig.sink.calls == [], "a redeploy read as a dead rail"
    assert v["flat_polls"] == 1


def test_a_redeploy_with_EQUAL_totals_through_the_LOOP_pages_nobody(rig, monkeypatch):
    """(c) in its sharpest form, through `poll_once`: the old pod sat flat at 0 for two
    polls, the new pod's first reading is also 0. Equal totals from two processes are
    two unrelated numbers, so the new pod's first poll is not a confirm - and the
    CONTROL half proves its own three flat polls still page."""
    monkeypatch.setenv(brm.FLAG, "1")
    for i in range(3):
        rig.poll(0, i=i, token=OLD)
    v = rig.poll(0, i=3, token=NEW)
    assert rig.sink.calls == [], "polls from before the deploy were counted as confirms"
    assert v["flat_polls"] == 0
    for i in range(4, 7):
        v = rig.poll(0, i=i, token=NEW)
    assert v["page"] is True and len(rig.sink.calls) == 1


def test_the_real_sink_PAGES_the_verdict(rig, monkeypatch, tmp_path):
    """Through the REAL `chart_health_alerts.emit`: the severity this module passes must
    be one the pager actually pages on. A recognised-but-non-paging severity would
    satisfy every check above and page nobody."""
    from api.services import chart_health_alerts as cha
    monkeypatch.setenv("CHART_HEALTH_COOLDOWN_DB_PATH", str(tmp_path / "cool.db"))
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.example/admin")
    monkeypatch.delenv("DISCORD_OPS_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("CHART_HEALTH_DISCORD_ENABLED", raising=False)
    monkeypatch.delenv("OPS_ALERT_EMAIL_TO", raising=False)
    pages = []
    monkeypatch.setattr(cha, "_page_discord", lambda key, message: pages.append(key))
    monkeypatch.setattr(cha, "emit", rig.real_emit)
    monkeypatch.setenv(brm.FLAG, "1")
    cha.clear()
    try:
        for i in range(4):
            rig.poll(500, i=i)
        assert pages == [brm.ALERT_KEY]
    finally:
        cha.clear()


def test_the_ledger_accumulates_drops_ACROSS_processes_for_the_digest(rig):
    rig.poll(100, 5, i=0, token=OLD)
    rig.poll(200, 9, i=1, token=OLD)        # +4
    rig.poll(10, 3, i=2, token=NEW)         # new process: +3 since its boot
    rig.poll(20, 3, i=3, token=NEW)         # +0
    day, err = brm.read_day("2026-09-28", base_dir=rig.rail)
    assert err is None
    assert day["drops"] == 5 + 4 + 3, day
    assert day["drop_polls"] == 3 and day["max_drop_delta"] == 5
    assert day["processes"] == 2 and day["polls"] == 4 and day["readable_polls"] == 4


def test_the_heartbeat_is_marked_on_ENTRY_even_when_the_read_RAISES(rig):
    """The recursive requirement (TERM-015): 'when did this signal last report?' must
    not depend on the signal being healthy."""
    def boom():
        raise RuntimeError("route exploded")
    v = brm.poll_once(now=T0, read=boom, token=OLD, in_session=True, base_dir=rig.rail)
    assert v is not None and v["kind"] == brm.UNREADABLE
    marker, err = ch.read_latest(brm.SIGNAL)
    assert err is None and marker is not None and marker["runs"] == 1
    day, _ = brm.read_day("2026-09-28", base_dir=rig.rail)
    assert day["unreadable_polls"] == 1 and "route exploded" in day["last_reason"]


def test_poll_once_NEVER_raises_even_when_the_ledger_cannot_be_written(rig, tmp_path):
    blocker = tmp_path / "blocker"
    blocker.write_text("x", encoding="utf-8")
    v = brm.poll_once(now=T0, read=lambda: _payload(1), token=OLD, in_session=True,
                      base_dir=str(blocker / "rail"))
    assert v is not None and v["kind"] == brm.OK


# ════════════════════════════════════════════ the digest, inside the ONE roll-up

def test_the_digest_NAMES_drops_and_says_so_when_there_are_none(rig):
    rig.poll(100, 0, i=0)
    rig.poll(110, 0, i=1)
    quiet = brm.format_digest(T0 + 120, base_dir=rig.rail)
    assert "no drops" in quiet and "DROPS:" not in quiet
    rig.poll(120, 6, i=2)
    loud = brm.format_digest(T0 + 180, base_dir=rig.rail)
    assert "DROPS: 6" in loud, loud


def test_the_digest_says_UNREADABLE_for_a_corrupt_ledger_never_no_drops(tmp_path):
    rail = tmp_path / "rail"
    rail.mkdir()
    (rail / "2026-09-28.json").write_text("{not json", encoding="utf-8")
    text = brm.format_digest(T0, base_dir=str(rail))
    assert "UNREADABLE" in text and "no drops" not in text


def test_the_digest_with_NO_ledger_says_nothing_was_recorded_never_no_drops(tmp_path):
    text = brm.format_digest(T0, base_dir=str(tmp_path / "empty"))
    assert "no reading recorded" in text and "no drops" not in text


def test_the_rollup_tool_carries_the_digest_and_a_drop_does_NOT_change_its_exit(rig, capsys):
    """A drop is a DIGEST, not an alert: the roll-up's exit (its ALERT prefix) belongs to
    the cadence contracts alone. ONE message: the digest rides inside the roll-up."""
    tool = _load(_TOOL, "cadence_tool_term013")
    roster = (ch.CadenceContract(signal="alpha-sweep", period="p", max_silence_s=3600),)
    base = str(rig.tmp / "cadence-fixture")
    now = T0 + 600
    ch.mark("alpha-sweep", now=now - 60, base_dir=base, contracts=roster)
    rig.poll(100, 0, i=0)
    rig.poll(110, 9, i=1)
    assert tool.run(now=now, base_dir=base, contracts=roster, rail_dir=rig.rail) == 0
    out = capsys.readouterr().out
    assert "every registered signal reported" in out and "DROPS: 9" in out
    assert out.count("CADENCE ROLL-UP") == 1


# ═══════════════════════════════════════ (b) THE WIRE - AST over the scheduler

def _calls(tree: ast.AST, obj: str | None, attr: str) -> int:
    n = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if obj is None and isinstance(f, ast.Name) and f.id == attr:
                n += 1
            elif obj is not None and isinstance(f, ast.Attribute) and f.attr == attr \
                    and isinstance(f.value, ast.Name) and f.value.id == obj:
                n += 1
    return n


def _fn(path: pathlib.Path, name: str) -> ast.FunctionDef:
    for n in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(n, ast.FunctionDef) and n.name == name:
            return n
    raise LookupError(f"{path.name} has no def {name}")


def test_B_the_reader_is_WIRED_to_a_running_thread_started_at_boot():
    """Item 25 section 4.6 method 3 - 'wired into no scheduler' fails BY NAME. The chain:
    api/main.py starts bars_continuous_audit, whose start() starts this reader's thread,
    whose loop calls poll_once, which carries the heartbeat."""
    assert _calls(_fn(_AUDIT, "start"), "bars_rail_monitor", "start") == 1
    main_tree = ast.parse((_REPO / "api" / "main.py").read_text(encoding="utf-8"))
    assert _calls(main_tree, "bars_continuous_audit", "start") >= 1
    assert _calls(_fn(_MON_SRC, "_loop"), None, "poll_once") == 1
    marks = [n for n in ast.walk(_fn(_MON_SRC, "poll_once"))
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
             and n.func.attr == "mark" and isinstance(n.func.value, ast.Name)
             and n.func.value.id == "cadence_heartbeat"]
    assert len(marks) == 1 and marks[0].args[0].value == brm.SIGNAL
    tool_tree = ast.parse(_TOOL.read_text(encoding="utf-8"))
    assert _calls(tool_tree, "bars_rail_monitor", "format_digest") == 1


def test_B_CONTROL_the_wire_probe_can_answer_ZERO():
    """NON-VACUITY: the same probe reads 0 for a start() that does not start the reader,
    and for a name nobody calls."""
    planted = ast.parse("def start():\n    _thread.start()\n    other.start()\n")
    assert _calls(planted, "bars_rail_monitor", "start") == 0
    assert _calls(_fn(_AUDIT, "start"), "bars_rail_monitor", "no_such_fn") == 0


def test_the_signal_is_CONTRACTED_in_the_cadence_roster():
    c = ch.contract_for(brm.SIGNAL)
    assert c is not None and c.max_silence_s >= 10 * brm.POLL_INTERVAL_S


# ═════════════════════════════════════════════════════════════════ the flag

def test_the_page_flag_defaults_OFF(monkeypatch):
    monkeypatch.delenv(brm.FLAG, raising=False)
    assert brm.page_enabled() is False
    monkeypatch.setenv(brm.FLAG, "0")
    assert brm.page_enabled() is False
    monkeypatch.setenv(brm.FLAG, "1")          # CONTROL - the reader can say yes
    assert brm.page_enabled() is True


def test_the_page_flag_is_declared_in_the_ledger_as_dark():
    ledger = json.loads((_REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    entry = ledger["flags"][brm.FLAG]
    assert entry["status"] == "dark" and entry["where"] == [] and entry["note"]
