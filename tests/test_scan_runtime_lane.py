"""W5-T14 rails: a stored RUNTIME document in the scan lanes (sweep, live, on-demand).

`docs/pine/SERVER-RUNTIME-DESIGN.md` section 7 T14 and 3.7 rule 3. The scan evaluator sends
a runtime document's universe to the pine-runtime service in chunks and maps the service's
outcomes onto its own four counts. NO NETWORK and NO REAL BARS STORE: the client talks to
`tests/fakes/pine_runtime_fake.PineRuntimeFake` (T11's), bars are stubbed at `_read_bars`,
the two per-call admission questions are faked (and, in section 9, the REAL ones are read
with the stage variables unset). Nothing here sets a flag outside `monkeypatch`.
"""
from __future__ import annotations

import base64
import datetime
import logging
import math
from zoneinfo import ZoneInfo

import pytest

from api.services import pine_runtime_client as prc
from api.services import pine_runtime_codec as codec
from api.services import runtime_definitions, scan_definition, user_definitions
from api.services.screener import scan_evaluator as ev
from api.services.screener import scan_run, scan_runtime, scan_store
from tests.fakes.pine_runtime_fake import FIXTURE_IDENTITY, FIXTURE_SECRET, PineRuntimeFake

T0 = 1_762_200_000          # the fake's "now"
SESSION = 20261103
SOURCE = "//@version=6\nindicator('cond')\nplot(close > open)"
DEF_ID = "u_0123456789ab"
OUT = "cond"


def _doc(outputs=None, source=SOURCE):
    return {"id": DEF_ID, "meta": {}, "plots": [{"key": OUT, "style": "line"}],
            "compute": {"kind": "runtime", "source": source,
                        "outputs": {OUT: 0} if outputs is None else outputs}}


def _row(**kw):
    row = {"def_id": DEF_ID, "version": 3, "user_id": "user-42", "definition": _doc(), "requirements": None}
    row.update(kw)
    return row


def _days(n, end=SESSION):
    """n consecutive WEEKDAY dates as YYYYMMDD ints, the last being `end`."""
    d = datetime.date(end // 10000, (end // 100) % 100, end % 100)
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.year * 10000 + d.month * 100 + d.day)
        d -= datetime.timedelta(days=1)
    return out[::-1]


def _bars(n=6, up=True, end=SESSION):
    days = _days(n, end)
    out, c = [], 100.0
    for i, t in enumerate(days):
        c += 1.0 if (up or i < n - 1) else -1.0      # the LAST bar decides `up`
        out.append({"t": t, "o": c - 0.5, "h": c + 1, "l": c - 1, "c": c, "v": 1000.0 + i})
    return out


def cond_script(cols):
    c = cols["c"]
    return {OUT: [float("nan")] + [1.0 if c[i] > c[i - 1] else 0.0 for i in range(1, len(c))]}


@pytest.fixture(autouse=True)
def _fresh_signing_memory():
    prc._forget_signing_times()
    yield
    prc._forget_signing_times()


class Switches:
    def __init__(self):
        self.verdict = None
        self.refusal = None
        self.asked = []
        self.flip_after = None           # (n calls to the admission, then refuse with this)

    def engine_withheld_reason(self, row, current=None):
        self.asked.append("verdict")
        return self.verdict

    def server_lane_refusal(self, row, *, lane):
        self.asked.append(("admission", lane))
        if self.flip_after is not None:
            n, why = self.flip_after
            if sum(1 for a in self.asked if isinstance(a, tuple)) > n:
                return why
        return self.refusal


class World:
    def __init__(self, sw, fake, store):
        self.sw, self.fake, self.store = sw, fake, store
        self.bars = {}
        self.reads = []
        self.hits_written = []
        self.cov_written = []


@pytest.fixture
def world(monkeypatch):
    sw = Switches()
    monkeypatch.setattr(user_definitions, "engine_withheld_reason", sw.engine_withheld_reason)
    monkeypatch.setattr(runtime_definitions, "server_lane_refusal", sw.server_lane_refusal, raising=False)
    fake = PineRuntimeFake(script=cond_script)
    w = World(sw, fake, None)

    monkeypatch.setattr(ev, "_runtime_client", lambda: prc.PineRuntimeClient(
        url="http://pine-runtime.test", secret=FIXTURE_SECRET, identity=FIXTURE_IDENTITY,
        transport=fake, clock=lambda: T0, sleep=lambda s: None))

    def _read(sym, tf, want):
        w.reads.append(sym)
        return list(w.bars.get(sym, []))
    monkeypatch.setattr(ev, "_read_bars", _read)
    monkeypatch.setattr(scan_store, "record_hits", lambda *a, **k: w.hits_written.append((a, k)))
    monkeypatch.setattr(scan_store, "record_coverage", lambda *a, **k: w.cov_written.append((a, k)))
    return w


def _doc_of(row=None):
    return scan_runtime.runtime_scan_doc(row or _row())


def _run(w, symbols, *, mode="nightly", doc=None, **kw):
    return ev.evaluate_one(doc or _doc_of(), "D", universe=symbols, as_of=SESSION, mode=mode,
                           tick=T0, **kw)


def _request_bars(call, i=0):
    b = call["jobs"][i]["bars"]
    return {k: codec.decode_column(base64.b64decode(b[k])) for k in ("t", "o", "h", "l", "c", "v")}


# ═══ 1. the four outcomes ═══════════════════════════════════════════════════

def test_hit_and_non_hit_are_answered_and_the_hit_row_carries_the_stored_bar_key(world):
    world.bars = {"UP": _bars(up=True), "DN": _bars(up=False)}
    out = _run(world, ["UP", "DN"])
    assert (out["evaluated"], out["answered"], out["dropped"], out["not_computable"], out["withheld"]) == (2, 2, 0, 0, 0)
    assert out["hits"] == ["UP"]
    assert out["hit_rows"] == [{"symbol": "UP", "value": 1.0, "bar_time": SESSION}]
    assert out["def_hash"] == runtime_definitions.handle(_doc())
    assert out["def_hash"].startswith(runtime_definitions.HASH_PREFIX)
    assert out["rev"] is None and out["recorded"] == 0 and out["record_refused"] == 0


def test_no_bars_and_stale_bars_are_dropped_by_name(world):
    world.bars = {"UP": _bars(), "OLD": _bars(end=20261030)}
    out = _run(world, ["UP", "NONE", "OLD"])
    assert (out["evaluated"], out["answered"], out["dropped"]) == (3, 1, 2)
    reasons = {e["ticker"]: e["reason"] for e in out["dropped_symbols"]}
    assert reasons == {"NONE": "no-bars", "OLD": "stale-bars"}
    # a dropped symbol is never sent
    assert [j["symbol"]["ticker"] for c in world.fake.calls for j in c["jobs"]] == ["UP"]


def test_a_withheld_symbol_is_withheld_never_answered_and_never_a_non_hit(world):
    world.bars = {"UP": _bars(), "BAD": _bars(), "DN": _bars(up=False)}
    world.fake.withhold["1:BAD"] = ("runtime:limit", "the script ran past its instruction budget")
    out = _run(world, ["UP", "BAD", "DN"])
    assert out["withheld"] == 1 and out["runtime_withheld"] == 1
    assert out["evaluated"] == 2 and out["answered"] == 2          # BAD is in neither
    assert out["hits"] == ["UP"]
    assert out["withheld_reason"] == "runtime:limit"
    assert out["runtime_withheld_guards"] == {"runtime:limit": 1}
    assert out["runtime_withheld_symbols"][0]["ticker"] == "BAD"
    assert "BAD" not in {e["ticker"] for e in out["dropped_symbols"]}
    assert out["evaluated"] + out["withheld"] == 3                 # the universe closes


def test_a_per_plot_refusal_is_not_computable_with_the_guards_sentence(world):
    world.bars = {"UP": _bars(), "X": _bars()}
    world.fake.refuse_output[OUT] = ("runtime:calc-bars-count", "needs more bars than this symbol has")
    out = _run(world, ["UP", "X"])
    assert out["not_computable"] == 2 and out["answered"] == 0 and out["withheld"] == 0
    assert out["hits"] == []
    assert all("runtime:calc-bars-count" in e["detail"] and "needs more bars" in e["detail"]
               for e in out["dropped_symbols"])
    assert {e["reason"] for e in out["dropped_symbols"]} == {ev.NOT_COMPUTABLE_REASON}


def test_a_plot_that_is_not_a_0_1_condition_is_not_computable_not_the_whole_universe(world):
    # a price-like plot: `!= 0` would answer "hit" for every symbol (the fail-closed direction)
    world.fake.script = lambda cols: {OUT: list(cols["c"])}
    world.bars = {"UP": _bars(), "DN": _bars(up=False)}
    out = _run(world, ["UP", "DN"])
    assert out["hits"] == [] and out["answered"] == 0 and out["not_computable"] == 2
    assert all("not a 0/1 condition" in e["detail"] for e in out["dropped_symbols"])


def test_na_on_the_as_of_bar_is_not_computable_but_na_in_warmup_is_fine(world):
    world.fake.script = lambda cols: {OUT: [float("nan")] * (len(cols["c"]) - 1) + [float("nan")]}
    world.bars = {"A": _bars()}
    out = _run(world, ["A"])
    assert (out["answered"], out["not_computable"]) == (0, 1)
    assert "na on the as-of bar" in out["dropped_symbols"][0]["detail"]
    world.fake.script = cond_script                                  # bar 0 is na, the rest 0/1
    world.bars = {"A": _bars(up=True)}
    assert _run(world, ["A"])["answered"] == 1


def test_duplicate_universe_entries_are_two_jobs_with_distinct_ids(world):
    world.bars = {"UP": _bars()}
    out = _run(world, ["UP", "UP"])
    assert out["evaluated"] == 2 and out["answered"] == 2 and out["hits"] == ["UP", "UP"]
    ids = [j["job"] for j in world.fake.calls[0]["jobs"]]
    assert len(set(ids)) == 2


# ═══ 2. bar time units and the as-of cut ════════════════════════════════════

def _et_open(y, m, d):
    return float(int(datetime.datetime(y, m, d, 9, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()))


def test_a_daily_bar_is_sent_at_its_0930_new_york_open_in_unix_seconds(world):
    bars = _bars(n=4, end=SESSION)
    world.bars = {"UP": bars}
    _run(world, ["UP"])
    sent = _request_bars(world.fake.calls[0])["t"]
    want = [_et_open(t // 10000, (t // 100) % 100, t % 100) for t in (b["t"] for b in bars)]
    assert sent == want
    assert sent[-1] == _et_open(2026, 11, 3) == 1_762_182_600.0 or sent[-1] == _et_open(2026, 11, 3)
    assert all(s > 1_000_000_000 for s in sent), "a YYYYMMDD int must never reach the service"


def test_the_utc_offset_follows_new_york_daylight_time(world):
    jul = _days(3, end=20260701)
    world.bars = {"UP": [{"t": t, "o": 1, "h": 2, "l": 1, "c": 1.5 + i, "v": 5.0} for i, t in enumerate(jul)]}
    ev.evaluate_one(_doc_of(), "D", universe=["UP"], as_of=20260701, tick=T0)
    sent = _request_bars(world.fake.calls[0])["t"]
    assert sent[-1] == _et_open(2026, 7, 1)
    assert datetime.datetime.fromtimestamp(sent[-1], datetime.timezone.utc).hour == 13   # EDT = UTC-4


def test_an_unreadable_bar_time_makes_the_symbol_not_computable_and_is_never_guessed(world):
    bars = _bars()
    bars[2] = {**bars[2], "t": 20261399}          # month 13
    world.bars = {"BAD": bars, "UP": _bars()}
    out = _run(world, ["BAD", "UP"])
    assert out["not_computable"] == 1 and out["answered"] == 1
    assert "time could not be read" in out["dropped_symbols"][0]["detail"]
    assert [j["symbol"]["ticker"] for c in world.fake.calls for j in c["jobs"]] == ["UP"]


def test_bars_after_the_runs_session_are_cut_before_sending(world):
    world.bars = {"UP": _bars(n=8, end=SESSION)}
    ev.evaluate_one(_doc_of(), "D", universe=["UP"], as_of=_days(8)[5], tick=T0)
    sent = _request_bars(world.fake.calls[0])["t"]
    assert len(sent) == 6                          # bars 0..5; the later two never leave this pod


# ═══ 3. chunking and the request ═════════════════════════════════════════════

def test_the_sweep_is_sent_in_chunks_of_the_clients_sweep_size_under_profile_sweep(world):
    syms = [f"S{i:03d}" for i in range(120)]
    world.bars = {s: _bars() for s in syms}
    out = _run(world, syms)
    assert [len(c["jobs"]) for c in world.fake.calls] == [50, 50, 20]
    assert {c["profile"] for c in world.fake.calls} == {"sweep"}
    assert prc.SWEEP_CHUNK == ev._RUNTIME_CHUNK == 50
    assert out["answered"] == 120 and out["evaluated"] == 120


def test_a_request_carries_the_document_the_owner_the_version_and_one_wanted_plot(world):
    world.bars = {"UP": _bars()}
    _run(world, ["UP"])
    call = world.fake.calls[0]
    assert call["definition"]["def_id"] == DEF_ID and call["definition"]["version"] == 3
    assert call["jobs"][0]["want"] == [OUT]
    assert call["jobs"][0]["ctx"]["newestBarIsForming"] is False
    assert call["jobs"][0]["ctx"]["runtimeInputs"] == {}
    assert call["owner"].startswith("hmac:") and "user-42" not in call["owner"]


def test_on_demand_runs_under_its_own_profile_and_writes_nothing(world):
    world.bars = {"UP": _bars()}
    out = _run(world, ["UP"], mode="on-demand")
    assert world.fake.calls[0]["profile"] == "on-demand"
    assert out["persisted"] is False and out["mode"] == "on-demand"
    assert world.hits_written == [] and world.cov_written == []


def test_the_profile_each_mode_would_use_is_sweep_for_nightly_and_live_on_demand_for_a_run():
    assert ev._RUNTIME_PROFILES == {"nightly": "sweep", "live": "sweep", "on-demand": "on-demand"}
    assert set(ev._RUNTIME_PROFILES.values()) <= set(prc.PROFILES)


# ═══ 4. the receipt ══════════════════════════════════════════════════════════

def test_a_clean_nightly_run_files_hits_and_coverage_under_the_runtime_handle(world):
    world.bars = {"UP": _bars(), "DN": _bars(up=False)}
    out = _run(world, ["UP", "DN"])
    assert out["persisted"] is True
    [(hargs, hkw)] = world.hits_written
    [(cargs, ckw)] = world.cov_written
    handle = runtime_definitions.handle(_doc())
    assert hargs[0] == cargs[0] == handle and handle.startswith("runtime:sha256:")
    assert hargs[3] == ["UP"] and hkw["values"] == {"UP": 1.0}
    assert (ckw["evaluated"], ckw["answered"], ckw["dropped"], ckw["not_computable"]) == (2, 2, 0, 0)
    assert ckw["freshness"] == "unknown"


def test_partial_service_failure_files_no_receipt_and_says_so_in_a_coverage_line(world, caplog):
    world.bars = {"UP": _bars(), "BAD": _bars()}
    world.fake.withhold["1:BAD"] = ("runtime:server-worker-oom", "the worker ran out of memory")
    with caplog.at_level(logging.WARNING, logger=ev.log.name):
        out = _run(world, ["UP", "BAD"])
    assert out["persisted"] is False
    assert world.hits_written == [] and world.cov_written == []
    assert out["hits"] == ["UP"], "what answered is still handed back, just not filed as a receipt"
    assert "WITHHELD 1 (runtime:server-worker-oom x1)" in out["coverage_line"]
    assert "evaluated 1 of 2" in out["coverage_line"]
    assert any("NO receipt filed" in r.getMessage() and "runtime:server-worker-oom" in r.getMessage()
               for r in caplog.records)


def test_a_service_that_is_unreachable_withholds_every_symbol_and_files_nothing(world):
    world.bars = {s: _bars() for s in ("A", "B", "C")}
    world.fake.script_next = [(503, b"{}")] * 5
    out = _run(world, ["A", "B", "C"])
    assert out["withheld"] == 3 and out["evaluated"] == 0 and out["answered"] == 0
    assert out["hits"] == [] and out["persisted"] is False
    assert out["withheld_reason"] == prc.UNAVAILABLE


def test_the_toolkit_history_gate_still_withholds_the_whole_definition(world):
    world.bars = {"UP": _bars()}

    class Lim:
        max_history_bars = 10
        max_symbols = None
    out = _run(world, ["UP"], limits=Lim())
    assert out["withheld"] == 1 and out["withheld_reason"] == ev.HISTORY_WITHHELD
    assert world.fake.calls == [] and world.reads == [] and out["persisted"] is False


def test_the_symbol_cap_is_the_toolkits_and_the_universe_closes(world):
    world.bars = {s: _bars() for s in ("A", "B", "C")}

    class Lim:
        max_history_bars = None
        max_symbols = 2
    out = _run(world, ["A", "B", "C"], limits=Lim())
    assert out["evaluated"] == 2 and out["withheld"] == 1 and out["withheld_reason"] == ev.SYMBOLS_WITHHELD
    assert out["runtime_withheld"] == 0


def test_no_rule_record_is_read_or_written_for_a_runtime_document(world, monkeypatch):
    from api.services import definition_record

    def boom(*a, **k):
        raise AssertionError("the rule record is a tree's (W5-T16)")
    monkeypatch.setattr(definition_record, "latest_through_by_symbol", boom)
    monkeypatch.setattr(ev, "_write_rule_record", boom)
    world.bars = {"UP": _bars()}
    assert _run(world, ["UP"])["recorded"] == 0


# ═══ 5. the admission: asked first, asked again per chunk, never decided once ═

def test_a_refused_admission_refuses_the_run_before_a_bar_is_read_or_a_request_sent(world):
    world.sw.refusal = ("runtime:killed", "this script is on the server's kill list")
    world.bars = {"UP": _bars()}
    with pytest.raises(ev.ScanRunRefused) as e:
        _run(world, ["UP"])
    assert e.value.gate == "not-scannable" and "kill list" in e.value.detail
    assert world.reads == [] and world.fake.calls == []


def test_a_stored_verdict_binds_first_and_names_itself(world):
    world.sw.verdict = "engine-refused: today's script engine refuses this script"
    world.sw.refusal = ("runtime:killed", "later")
    with pytest.raises(ev.ScanRunRefused) as e:
        _run(world, ["UP"])
    assert "engine-refused" in e.value.detail
    assert [a for a in world.sw.asked if isinstance(a, tuple)] == [], "the verdict is asked BEFORE admission"


def test_a_kill_between_chunks_withholds_the_rest_and_sends_nothing_more(world):
    syms = [f"S{i:03d}" for i in range(120)]
    world.bars = {s: _bars() for s in syms}
    # 1 ask at the door + 1 for chunk 1 pass; chunk 2 onwards is refused
    world.sw.flip_after = (2, ("runtime:killed", "killed mid-run"))
    out = _run(world, syms)
    assert len(world.fake.calls) == 1 and len(world.fake.calls[0]["jobs"]) == 50
    assert out["evaluated"] == 50 and out["answered"] == 50
    assert out["withheld"] == 70 and out["withheld_reason"] == "runtime:killed"
    assert out["persisted"] is False
    assert out["evaluated"] + out["withheld"] == 120


def test_the_admission_is_asked_in_the_lane_of_the_run(world):
    world.bars = {"UP": _bars()}
    _run(world, ["UP"], mode="on-demand")
    assert {a[1] for a in world.sw.asked if isinstance(a, tuple)} == {"on-demand"}
    world.sw.asked.clear()
    _run(world, ["UP"])
    assert {a[1] for a in world.sw.asked if isinstance(a, tuple)} == {"sweep"}


# ═══ 6. live: closed bars only (ruling Q3) ═══════════════════════════════════

def test_live_mode_refuses_a_runtime_document_by_gate_cadence_before_reading_a_bar(world):
    world.bars = {"UP": _bars()}
    with pytest.raises(ev.ScanRunRefused) as e:
        _run(world, ["UP"], mode="live")
    assert e.value.gate == "cadence" and "CLOSED bars" in e.value.detail
    assert world.reads == [] and world.fake.calls == []


def test_the_live_cycle_counts_a_runtime_document_as_refused_cadence_and_the_receipt_closes(world, monkeypatch):
    receipts = {}
    monkeypatch.setattr(ev, "live_enabled", lambda: True)
    monkeypatch.setattr(ev, "_live_session_state", lambda now: None)
    monkeypatch.setattr(ev, "previous_session", lambda s: 20261102)
    monkeypatch.setattr(ev, "_finish_live", lambda receipt, started, **kw: receipts.update(receipt, **kw) or receipt)
    monkeypatch.setattr(scan_store, "last_live_cycle", lambda tf: None)
    from api.services import scan_volume
    monkeypatch.setattr(scan_volume, "full_market_snapshot", lambda: {})
    monkeypatch.setattr(ev.snapshot_builder, "build_in_flight", lambda: False)
    def _never(*a, **k):
        raise AssertionError("phase 1 refuses a runtime document; evaluate_one is not reached")
    monkeypatch.setattr(ev, "evaluate_one", _never)
    ev._run_live_cycle([_doc_of()], "D", universe=["UP"])
    assert receipts["refused"] == 1 and not receipts["swept"]
    assert receipts["refusals"][0]["gate"] == "cadence"
    assert world.fake.calls == [] and world.reads == []


# ═══ 7. scannability and identity ════════════════════════════════════════════

def test_a_runtime_document_is_scannable_only_with_exactly_one_plot():
    spec = scan_runtime.runtime_scan_spec(_doc())
    assert spec == {"def_hash": runtime_definitions.handle(_doc()), "plot": OUT}
    for outs in ({}, {"a": 0, "b": 1}):
        with pytest.raises(scan_definition.ScanRefused) as e:
            scan_runtime.runtime_scan_spec(_doc(outputs=outs))
        assert e.value.gate == "tree" and "ONE plot" in e.value.detail
    with pytest.raises(scan_definition.ScanRefused) as e:
        scan_runtime.runtime_scan_spec({"compute": {"kind": "ast"}})
    assert e.value.gate == "kind"


def test_the_runtime_handle_is_the_stores_own_and_cannot_collide_with_a_tree_hash():
    h = ev._scannable_handle(_doc())
    assert h == ev._result_handle(_doc()) == runtime_definitions.HASH_PREFIX + runtime_definitions.source_hash(SOURCE)
    assert not h.startswith("sha256:")


def test_a_dict_copy_loses_the_row_and_the_run_refuses_by_name(world):
    world.bars = {"UP": _bars()}
    bare = dict(_doc_of())                      # not a RuntimeScanDoc
    with pytest.raises(ev.ScanRunRefused) as e:
        _run(world, ["UP"], doc=bare)
    assert e.value.gate == "not-scannable" and "without its stored row" in e.value.detail
    assert world.fake.calls == []


def test_the_scan_doc_remembers_its_row_and_is_still_the_document():
    row = _row()
    doc = scan_runtime.runtime_scan_doc(row)
    assert doc == row["definition"] and doc.lane_row is row
    assert runtime_definitions.is_runtime(doc)


# ═══ 8. the sweep candidate filter ═══════════════════════════════════════════

@pytest.fixture
def live_rows(monkeypatch):
    rows = []
    monkeypatch.setattr(user_definitions, "live_definitions", lambda: list(rows))
    return rows


def test_the_sweep_admits_a_runtime_row_only_when_the_lane_admission_says_so(world, live_rows):
    live_rows.append(_row())
    world.sw.refusal = ("runtime:server-stage", "not switched on")
    assert ev.definitions_to_sweep() == []
    world.sw.refusal = None
    [doc] = ev.definitions_to_sweep()
    assert isinstance(doc, scan_runtime.RuntimeScanDoc) and doc.lane_row["def_id"] == DEF_ID
    assert ("admission", "sweep") in world.sw.asked


def test_the_sweep_filter_still_honours_the_verdict_and_the_consumer_contract(world, live_rows):
    live_rows.append(_row())
    world.sw.verdict = "engine-refused: ..."
    assert ev.definitions_to_sweep() == []


def test_two_members_with_the_same_script_share_one_sweep_entry(world, live_rows):
    live_rows += [_row(user_id="a"), _row(user_id="b", def_id="u_0123456789ac")]
    assert len(ev.definitions_to_sweep()) == 1


def test_a_tree_definition_is_swept_exactly_as_before(world, live_rows):
    from tests.test_scan_evaluator import _definition, _num, _op, _series
    tree_def = _definition(_op(">", _series("close"), _num(100)), def_id="u_00000000aaaa")
    live_rows.append({"def_id": "u_00000000aaaa", "version": 1, "user_id": "x",
                      "definition": tree_def, "requirements": None})
    live_rows.append(_row())
    world.sw.refusal = ("runtime:server-stage", "off")
    assert ev.definitions_to_sweep() == [tree_def]


def test_run_sweep_resolves_a_runtime_entry_to_its_handle_and_sweeps_it(world, monkeypatch):
    world.bars = {"UP": _bars(), "DN": _bars(up=False)}
    monkeypatch.setattr(ev, "expected_session", lambda: SESSION)
    monkeypatch.setattr(ev, "_resume_order", lambda entries, tf, as_of, **k: list(entries))
    monkeypatch.setattr(ev, "_now_et", lambda: datetime.datetime(2026, 11, 4, 5, 0, tzinfo=ZoneInfo("America/New_York")))
    monkeypatch.setattr(ev, "sweep_deadline", lambda now=None: datetime.datetime(2026, 11, 4, 9, 0, tzinfo=ZoneInfo("America/New_York")))
    receipt = ev.run_sweep([_doc_of()], universe=["UP", "DN"], as_of=SESSION)
    assert receipt["swept"] == 1 and receipt["refused"] == 0 and receipt["hits"] == 1
    assert world.hits_written[0][0][0] == runtime_definitions.handle(_doc())


# ═══ 9. NOTHING reaches members while PINE_RUNTIME_SERVER_STAGE is unset ═════

_REAL_SERVER_LANE_REFUSAL = runtime_definitions.server_lane_refusal


def test_with_the_server_stage_unset_no_runtime_document_is_swept_run_or_sent(world, monkeypatch):
    """The REAL `server_lane_refusal` and the REAL stage variables (only the world around
    them pinned): with `PINE_RUNTIME_SERVER_STAGE` unset nothing is swept, run or sent."""
    monkeypatch.setattr(runtime_definitions, "server_lane_refusal", _REAL_SERVER_LANE_REFUSAL)
    _real_world_without_switches(monkeypatch, world)


def _real_world_without_switches(monkeypatch, world):
    from api.services import runtime_definitions as rd
    monkeypatch.setattr(rd, "not_graded", lambda source, graded_only=False: None)
    monkeypatch.setattr(rd, "_owner_role", lambda owner_id: "member")
    monkeypatch.setattr(rd, "kill_list", lambda: [])
    monkeypatch.setattr(user_definitions, "engine_withheld_reason", lambda row, current=None: None)
    monkeypatch.setenv(rd.STAGE_ENV, "all")
    monkeypatch.setenv(rd.SERVICE_URL_ENV, "http://pine-runtime.test")
    monkeypatch.setenv(rd.SERVICE_SECRET_ENV, FIXTURE_SECRET)
    monkeypatch.delenv(rd.SERVER_STAGE_ENV, raising=False)
    monkeypatch.setattr(user_definitions, "live_definitions", lambda: [_row()])
    monkeypatch.setattr(ev, "_runtime_client", lambda: prc.PineRuntimeClient(
        url="http://pine-runtime.test", secret=FIXTURE_SECRET, identity=FIXTURE_IDENTITY,
        transport=world.fake, clock=lambda: T0, sleep=lambda s: None))
    monkeypatch.setattr(ev, "_read_bars", lambda sym, tf, want: world.reads.append(sym) or _bars())
    monkeypatch.setattr(runtime_definitions, "stage", runtime_definitions.stage)
    # 1. the sweep's candidate filter
    assert ev.definitions_to_sweep() == []
    # 2. the evaluator, handed a runtime document directly
    with pytest.raises(ev.ScanRunRefused) as e:
        ev.evaluate_one(scan_runtime.runtime_scan_doc(_row()), "D", universe=["UP"], as_of=SESSION, tick=T0)
    assert "server runs" in e.value.detail
    # 3. the on-demand door
    monkeypatch.setattr(user_definitions, "get", lambda uid, did, version=None: _row())
    with pytest.raises(scan_run.RunRefused) as r:
        scan_run._load_definition("user-42", DEF_ID)
    assert r.value.gate == "gate:not-scannable" and "server runs" in str(r.value)
    # and not one request, not one bar
    assert world.fake.calls == [] and world.reads == []
    # positive control: the SAME world with the server stage on admits it all
    monkeypatch.setenv(rd.SERVER_STAGE_ENV, "all")
    assert len(ev.definitions_to_sweep()) == 1
    assert scan_run._load_definition("user-42", DEF_ID)["def_id"] == DEF_ID
    out = ev.evaluate_one(scan_runtime.runtime_scan_doc(_row()), "D", universe=["UP"], as_of=SESSION, tick=T0, mode="on-demand")
    assert len(world.fake.calls) == 1 and out["evaluated"] == 1


# ═══ 10. the on-demand door (scan_run) ═══════════════════════════════════════

def test_load_definition_turns_a_runtime_refusal_into_gate_not_scannable_with_the_guards_sentence(world, monkeypatch):
    monkeypatch.setattr(user_definitions, "get", lambda uid, did, version=None: _row())
    world.sw.refusal = ("runtime:killed", "THE-GUARDS-OWN-SENTENCE")
    with pytest.raises(scan_run.RunRefused) as e:
        scan_run._load_definition("user-42", DEF_ID)
    assert e.value.gate == "gate:not-scannable" and "THE-GUARDS-OWN-SENTENCE" in str(e.value)
    assert ("admission", "on-demand") in world.sw.asked


def test_load_definition_asks_the_verdict_before_the_admission(world, monkeypatch):
    monkeypatch.setattr(user_definitions, "get", lambda uid, did, version=None: _row())
    world.sw.verdict = "engine-refused: held"
    world.sw.refusal = ("runtime:killed", "later")
    with pytest.raises(scan_run.RunRefused) as e:
        scan_run._load_definition("user-42", DEF_ID)
    assert "engine-refused" in str(e.value)


def test_load_definition_leaves_a_tree_row_alone(world, monkeypatch):
    from tests.test_scan_evaluator import _definition, _num, _op, _series
    row = {"def_id": "u_00000000aaaa", "definition": _definition(_op(">", _series("close"), _num(1)),
                                                                   def_id="u_00000000aaaa")}
    monkeypatch.setattr(user_definitions, "get", lambda uid, did, version=None: row)
    world.sw.refusal = ("runtime:killed", "must never be asked of a tree")
    assert scan_run._load_definition("u", "u_00000000aaaa") is row
    assert not [a for a in world.sw.asked if isinstance(a, tuple)]


def test_submit_run_accepts_an_admitted_runtime_row_and_the_job_runs_through_the_service(world, monkeypatch):
    monkeypatch.setattr(user_definitions, "get", lambda uid, did, version=None: _row())
    monkeypatch.setattr(scan_run._POOL, "submit", lambda fn, *a, **k: None)   # run it by hand below
    monkeypatch.setattr(ev, "expected_session", lambda: SESSION)
    monkeypatch.setattr(ev, "_note_demand", lambda s: None, raising=False)
    world.bars = {"UP": _bars(), "DN": _bars(up=False)}
    job_id = scan_run.submit_run("user-42", DEF_ID, symbols=["UP", "DN"], as_of=SESSION)
    scan_run._run_job(job_id)
    st = scan_run.job_status(job_id, "user-42")
    assert st["state"] == "done", st
    assert [h["symbol"] for h in st["hits"]] == ["UP"]
    assert world.fake.calls[0]["profile"] == "on-demand"
    assert world.hits_written == [] and world.cov_written == []
    scan_run._JOBS.pop(job_id, None)


def test_submit_run_refuses_a_runtime_row_with_two_plots_by_gate_not_scannable(world, monkeypatch):
    row = _row(definition=_doc(outputs={"a": 0, "b": 1}))
    monkeypatch.setattr(user_definitions, "get", lambda uid, did, version=None: row)
    with pytest.raises(scan_run.RunRefused) as e:
        scan_run.submit_run("user-42", DEF_ID, symbols=["UP"], as_of=SESSION)
    assert e.value.gate == "gate:not-scannable" and "ONE plot" in str(e.value)
    assert world.fake.calls == []


# ═══ 11. closed doors named in the mutation table ═══════════════════════════

@pytest.mark.parametrize("tf", ["5", "W", "60"])
def test_a_runtime_scan_is_daily_only_in_every_mode(world, tf):
    world.bars = {"UP": _bars()}
    for mode in ("nightly", "on-demand"):
        with pytest.raises(ev.ScanRunRefused) as e:
            ev.evaluate_one(_doc_of(), tf, universe=["UP"], as_of=SESSION, mode=mode, tick=T0)
        assert e.value.gate == "tf"
    assert world.reads == [] and world.fake.calls == []


@pytest.mark.parametrize("hole", ["def_id", "version", "user_id"])
def test_a_row_missing_its_id_version_or_owner_refuses_by_name(world, hole):
    row = _row()
    row[hole] = None
    world.bars = {"UP": _bars()}
    with pytest.raises(ev.ScanRunRefused) as e:
        _run(world, ["UP"], doc=scan_runtime.runtime_scan_doc(row))
    assert e.value.gate == "not-scannable" and world.fake.calls == []


def test_a_handle_without_the_runtime_prefix_is_refused(monkeypatch):
    monkeypatch.setattr(runtime_definitions, "handle", lambda d: "sha256:" + "0" * 64)
    with pytest.raises(scan_definition.ScanRefused) as e:
        scan_runtime.runtime_scan_spec(_doc())
    assert e.value.gate == "hash"


def test_a_symbol_whose_bars_use_unix_seconds_already_is_passed_through(world):
    bars = _bars(n=4)
    secs = [{**b, "t": _et_open(b["t"] // 10000, (b["t"] // 100) % 100, b["t"] % 100)} for b in bars]
    world.bars = {"UP": secs}
    monkeypatch_session = None  # the session check reads the ET date of the epoch
    out = _run(world, ["UP"])
    assert out["answered"] == 1
    assert _request_bars(world.fake.calls[0])["t"] == [b["t"] for b in secs]


# ═══ 12. FIX r1: the engine's warm-up is na (NaN) and the lane reads it as na ═

def _warm_script(k):
    """First `k` bars na (the engine's warm-up), then a 0/1 condition."""
    def script(cols):
        c = cols["c"]
        return {OUT: [float("nan")] * k + [1.0 if c[i] > c[i - 1] else 0.0 for i in range(k, len(c))]}
    return script


def test_warmup_na_bars_are_skipped_by_the_condition_check_and_the_symbol_answers(world):
    world.fake.script = _warm_script(3)
    world.fake.withheld_bars = 3
    world.bars = {"UP": _bars(n=8), "DN": _bars(n=8, up=False)}
    out = _run(world, ["UP", "DN"])
    assert (out["answered"], out["not_computable"], out["withheld"]) == (2, 0, 0)
    assert out["hits"] == ["UP"]


def test_a_symbol_whose_whole_run_is_warmup_is_not_computable_never_a_non_hit(world):
    world.bars = {"UP": _bars(n=6)}
    world.fake.script = _warm_script(6)
    world.fake.withheld_bars = 6
    out = _run(world, ["UP"])
    assert (out["answered"], out["not_computable"], out["hits"]) == (0, 1, [])
    assert "na on the as-of bar" in out["dropped_symbols"][0]["detail"]


def test_a_non_condition_value_AFTER_the_warmup_is_still_not_computable(world):
    world.fake.script = lambda cols: {OUT: [float("nan"), float("nan"), 7.0] + [1.0] * (len(cols["c"]) - 3)}
    world.fake.withheld_bars = 2
    world.bars = {"UP": _bars(n=6)}
    out = _run(world, ["UP"])
    assert out["not_computable"] == 1 and "not a 0/1 condition" in out["dropped_symbols"][0]["detail"]


def test_admission_is_the_public_server_lane_admission_with_the_plot(world, monkeypatch):
    from api.services import runtime_server_lane
    seen = []
    real = runtime_server_lane.admission
    monkeypatch.setattr(runtime_server_lane, "admission", lambda row, plot, lane: seen.append((plot, lane)) or real(row, plot, lane))
    world.bars = {"UP": _bars()}
    _run(world, ["UP"], mode="on-demand")
    assert seen and set(seen) == {(OUT, "on-demand")}


def test_the_shared_store_time_helper_is_the_one_conversion():
    assert scan_runtime.store_time_seconds(20261103) == _et_open(2026, 11, 3)
    assert scan_runtime.store_time_seconds(_et_open(2026, 11, 3)) == _et_open(2026, 11, 3)
    assert scan_runtime.store_time_seconds(20261399) is None
    assert scan_runtime.store_time_seconds(True) is None and scan_runtime.store_time_seconds(None) is None


def test_an_admission_that_cannot_answer_admits_nothing():
    got = scan_runtime.runtime_admission(_row(), "no-such-lane", OUT)      # T11's admission raises
    assert got is not None and got[0] == "runtime:server-unavailable"


def test_a_finite_value_inside_the_warmup_withholds_the_symbol_never_a_non_hit(world):
    """A service that disagrees with the engine's curtain (finite values inside the warm-up, honest
    digest) is refused by T11 r2 as integrity: the lane counts that symbol `withheld` -- not answered,
    not a hit, not a non-hit -- and files no receipt."""
    from tests.fakes.pine_runtime_fake import b64_column, redigest

    def finite_warmup(reply):
        for r in reply["results"]:
            n = len(codec.decode_column(base64.b64decode(r["columns"][OUT])))
            r["columns"][OUT] = b64_column([1.0] * n)
            r["digest"] = redigest(FIXTURE_IDENTITY, r, n)
        return reply
    world.fake.withheld_bars = 3
    world.fake.tamper = finite_warmup
    world.bars = {"UP": _bars(n=8)}
    out = _run(world, ["UP"])
    assert (out["withheld"], out["answered"], out["evaluated"], out["hits"]) == (1, 0, 0, [])
    assert out["withheld_reason"] == prc.INTEGRITY
    assert "warm-up" in out["runtime_withheld_symbols"][0]["sentence"]
    assert out["persisted"] is False and world.hits_written == []
