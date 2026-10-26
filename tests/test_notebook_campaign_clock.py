"""Rails for the launcher-only clock shift (ruling W11-R49, lane F-CLOCK-1):
tools/notebook_campaign/sandbox_clock.py and the runner's clock groups.

1. Nothing under api/ or app/ imports or names the shim (with a control proving the scan can see a name).
2. The launcher's refusals fire (C:\\data, /data, a non-loopback host, a naive clock), with controls that
   pass a sandbox dir and a loopback host.
3. In-process, with the shift installed: the wave 9 modules' today-ET and a routine's day binding report the
   shifted day, every spelling of a clock read in a scoped module is shifted (module-level, function-local,
   a bound method kept in a global, a module imported AFTER install through the meta-path hook), code
   outside the scope keeps the real clock, and uninstall gives every module the real clock back.
"""
import json
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "notebook_campaign"))
import run_campaign as rc  # noqa: E402
import sandbox_clock as sc  # noqa: E402

SPEC = json.loads((REPO / "tools" / "notebook_campaign" / "personas.json").read_text(encoding="utf-8"))
SUNDAY_NIGHT = "2026-11-22T21:00:00-05:00"
NAME_RE = re.compile(r"\bsandbox_clock\b")
SKIP_DIRS = {"node_modules", "dist", "__pycache__", ".vite", "coverage"}


def _files_naming(root: Path) -> list[str]:
    hits = []
    for path in root.rglob("*"):
        if not path.is_file() or SKIP_DIRS & set(path.relative_to(root).parts):
            continue
        if path.suffix.lower() not in {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".html", ".css"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if NAME_RE.search(text):
            hits.append(path.relative_to(REPO).as_posix())
    return hits


# ── 1. production code never reaches the shim ─────────────────────────────────────────────

@pytest.mark.parametrize("tree", ["api", "app"])
def test_no_production_file_imports_or_names_the_clock_shim(tree):
    assert _files_naming(REPO / tree) == []


def test_control_the_scan_finds_the_name_where_it_is():
    hits = _files_naming(REPO / "tools" / "notebook_campaign")
    assert "tools/notebook_campaign/run_campaign.py" in hits


# ── 2. refusals ─────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", [r"C:\data", r"C:\DATA\clock", r"c:\data\sub\x", "/data", "/data/x"])
def test_the_shared_data_root_is_refused(path):
    assert sc.refuse_data_dir(path)


@pytest.mark.parametrize("path", [r"C:\data-hubtest", r"C:\Users\x\scratchpad\clock-dry", r"C:\database"])
def test_control_a_sandbox_dir_is_not_refused(path):
    assert sc.refuse_data_dir(path) is None


def test_control_a_real_temp_dir_is_not_refused(tmp_path):
    assert sc.refuse_data_dir(tmp_path / "clock-sandbox") is None


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.5", "uctintelligence.com", ""])
def test_a_non_loopback_host_is_refused(host):
    assert sc.refuse_host(host)


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
def test_control_a_loopback_host_is_allowed(host):
    assert sc.refuse_host(host) is None


def test_a_clock_without_an_offset_is_refused():
    with pytest.raises(ValueError):
        sc.parse_clock("2026-11-22T21:00:00")
    assert sc.parse_clock(SUNDAY_NIGHT).utcoffset() == timedelta(hours=-5)


@pytest.mark.parametrize("argv", [
    ["--clock", SUNDAY_NIGHT, "--data-dir", r"C:\data"],
    ["--clock", SUNDAY_NIGHT, "--data-dir", "/data/clock"],
    ["--clock", SUNDAY_NIGHT, "--data-dir", "SANDBOX", "--host", "0.0.0.0"],
    ["--clock", "2026-11-22T21:00:00", "--data-dir", "SANDBOX"],
])
def test_the_launcher_exits_before_importing_anything(argv, tmp_path, capsys, monkeypatch):
    argv = [str(tmp_path / "sb") if a == "SANDBOX" else a for a in argv]
    before = set(sys.modules)
    assert sc.main(argv) == 2
    assert "REFUSED" in capsys.readouterr().out
    assert not {m for m in set(sys.modules) - before if m.startswith(("api.", "hub_sandbox_boot", "uvicorn"))}
    assert not (tmp_path / "sb").exists()


# ── 3. the shift, in process ────────────────────────────────────────────────────────────

PROBE = '''
import datetime as dtm
import time
from datetime import date, datetime, timezone
from time import time as bare_time

_now = datetime.now
CAPTURED_AT_IMPORT = datetime.now(timezone.utc)

def module_level():
    return {"now_utc": datetime.now(timezone.utc), "naive": datetime.now(), "utcnow": datetime.utcnow(),
            "today": date.today(), "dtm": dtm.datetime.now(timezone.utc), "time": time.time(),
            "bare_time": bare_time(), "bound": _now(timezone.utc), "dt_today": datetime.today()}

def function_local():
    from datetime import datetime as D, date as DD
    import datetime as M
    import time as T
    return {"now_utc": D.now(timezone.utc), "today": DD.today(), "mod": M.datetime.now(timezone.utc),
            "time": T.time()}
'''


@pytest.fixture
def probe_pkg(tmp_path, monkeypatch):
    pkg = tmp_path / "clockprobe_pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "early.py").write_text(PROBE, encoding="utf-8")
    (pkg / "late.py").write_text(PROBE, encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    yield "clockprobe_pkg"
    for m in [m for m in sys.modules if m.startswith("clockprobe_pkg")]:
        del sys.modules[m]


@pytest.fixture
def shift():
    sh = sc.ClockShift(sc.parse_clock(SUNDAY_NIGHT), scope=("api", "clockprobe_pkg"))
    yield sh
    sh.uninstall()
    assert sys.modules["datetime"].__class__.__name__ == "module"


def _all_near(values: dict, target: datetime, tol_s: float = 120.0):
    tz_et = sc._et()
    for k, v in values.items():
        if isinstance(v, float):
            v = datetime.fromtimestamp(v, timezone.utc)
        if isinstance(v, datetime):
            if v.tzinfo is None:
                v = v.astimezone() if k != "utcnow" else v.replace(tzinfo=timezone.utc)
            assert abs((v - target).total_seconds()) < tol_s, (k, v)
        else:
            assert v == target.astimezone(tz_et).date() or v == target.astimezone().date(), (k, v)


def test_wave9_today_et_and_a_routines_day_binding_read_the_shifted_sunday(shift):
    from api.services.journal_two import routines, trading_days
    real_today = trading_days.today_et()
    shift.install()
    try:
        assert trading_days.today_et() == date(2026, 11, 22)                 # Sunday ET
        assert routines._today(None) == date(2026, 11, 22)
        # the routine's "today" binds to the next session: Monday 2026-11-23
        out = routines.read_days("nobody", [], ["today"])
        assert out["resolved"] == {"today": "2026-11-23"}
        assert trading_days.session_on_or_after(trading_days.today_et()) == date(2026, 11, 23)
    finally:
        shift.uninstall()
    assert trading_days.today_et() == real_today
    assert routines._today(None) == real_today


def test_an_et_evening_that_is_already_tomorrow_in_utc_stays_on_the_et_day():
    sh = sc.ClockShift(sc.parse_clock("2026-11-22T20:30:00-05:00"))       # 01:30Z Monday
    from api.services.journal_two import trading_days
    sh.install()
    try:
        assert datetime.now(timezone.utc).date() != date(2026, 11, 23)     # this test module: real clock
        assert trading_days.today_et() == date(2026, 11, 22)
    finally:
        sh.uninstall()


def test_every_spelling_in_scope_is_shifted_and_out_of_scope_is_not(shift, probe_pkg):
    import importlib
    early = importlib.import_module(probe_pkg + ".early")                  # before install: swept
    shift.install()
    late = importlib.import_module(probe_pkg + ".late")                    # after install: meta-path hook
    target = sc.parse_clock(SUNDAY_NIGHT)
    try:
        for mod in (early, late):
            _all_near(mod.module_level(), target)
            _all_near(mod.function_local(), target)
        assert abs((late.CAPTURED_AT_IMPORT - target).total_seconds()) < 120
        # out of scope (this test module): the real clock
        import datetime as here
        assert abs(here.datetime.now(timezone.utc).timestamp() - time.time()) < 5
        assert abs(time.time() - sc._real_time()) < 5
        # instances are REAL datetimes, and isinstance answers as for the real class
        v = early.module_level()["now_utc"]
        assert type(v) is sc._RD
        assert isinstance(sc._RD(2020, 1, 1), early.datetime) and isinstance(sc._RD(2020, 1, 1), early.date)
        assert type(early.datetime(2026, 1, 2)) is sc._RD
        assert type(early.datetime.fromisoformat("2026-01-02T03:04:05")) is sc._RD
    finally:
        shift.uninstall()
    for mod in (early, late):
        vals = mod.module_level()
        assert abs(vals["now_utc"].timestamp() - time.time()) < 5
        assert abs(vals["time"] - time.time()) < 5
        assert abs(mod.function_local()["now_utc"].timestamp() - time.time()) < 5
        assert abs(vals["bound"].timestamp() - time.time()) < 5


def test_the_clock_ticks_forward_from_the_instant():
    clock = sc.OffsetClock(sc.parse_clock(SUNDAY_NIGHT))
    a = clock.time()
    time.sleep(0.05)
    b = clock.time()
    assert 0.04 < b - a < 2
    assert abs(a - sc.parse_clock(SUNDAY_NIGHT).timestamp()) < 2


def test_pydantic_reads_a_shifted_annotation_as_a_datetime(shift):
    from pydantic import BaseModel
    shift.install()
    try:
        class M(BaseModel):
            at: shift.Datetime
            day: shift.Date
        m = M(at="2026-01-02T03:04:05+00:00", day="2026-01-02")
        assert type(m.at) is sc._RD and m.day == date(2026, 1, 2)
    finally:
        shift.uninstall()


# ── what cannot be shifted ──────────────────────────────────────────────────────────────

def test_sqlite_clock_defaults_are_found_through_nested_parens():
    sql = ("CREATE TABLE IF NOT EXISTS t1 (id TEXT PRIMARY KEY, a TEXT DEFAULT (datetime('now')), "
           "b TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, c TEXT DEFAULT 'x', d INTEGER DEFAULT (strftime('%s','now')));"
           " ALTER TABLE t2 ADD COLUMN seen_at TEXT DEFAULT CURRENT_TIMESTAMP;"
           " CREATE TABLE t3 (helpful INTEGER NOT NULL,     -- 1 = up, 0 = down\n"
           "   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (helpful))")
    got = {(t, c) for t, c, _ in sc.now_defaults_in_create(sql)}
    assert got == {("t1", "a"), ("t1", "b"), ("t1", "d"), ("t2", "seen_at"), ("t3", "created_at")}


def test_the_unshiftable_list_is_read_from_the_source():
    st = sc.static_unshiftable(REPO)
    assert st["tables"], "the scan found no SQLite clock default at all; it is broken"
    assert any(f.endswith("auth_service.py") for f in st["query_files"])      # last_seen_at = CURRENT_TIMESTAMP


# ── the runner's clock groups ───────────────────────────────────────────────────────────

CLOCK_PERSONAS = {"P13", "P20", "P37", "P38", "P41"}


def test_the_calendar_edge_personas_declare_a_clock_and_need_it():
    by = {p["id"]: p for p in SPEC["personas"]}
    for pid in CLOCK_PERSONAS:
        assert rc.persona_needs_clock(by[pid]), pid
        assert sc.parse_clock(by[pid]["clock"]), pid
    assert by["P13"]["clock"].startswith("2026-11-30")
    assert "2025" not in json.dumps(by["P13"]["scripts"])


def test_clock_groups_order_by_instant_and_share_a_boot():
    people = [{"id": "A", "clock": "2026-11-28T11:00:00-05:00", "scripts": [{"needs": ["clock"], "steps": []}]},
              {"id": "B", "clock": "2026-11-22T21:00:00-05:00", "scripts": [{"steps": [{"needs": ["clock"]}]}]},
              {"id": "C", "clock": "2026-11-23T02:00:00+00:00", "scripts": [{"needs": ["clock"], "steps": []}]},
              {"id": "D", "scripts": [{"steps": [{"do": "noop"}]}]}]
    groups = rc.clock_groups(people)
    assert [[p["id"] for p in ps] for _, ps in groups] == [["B", "C"], ["A"]]       # B and C: one instant


def test_a_clock_persona_without_an_instant_is_refused():
    with pytest.raises(ValueError):
        rc.clock_groups([{"id": "X", "scripts": [{"needs": ["clock"], "steps": []}]}])


def test_the_served_clock_must_be_the_personas_instant():
    assert rc.verify_clock_server({"clock_shift": {"instant": "2026-11-23T02:00:00+00:00"}}, SUNDAY_NIGHT) is None
    assert rc.verify_clock_server({"clock_shift": {"instant": "2026-11-23T03:00:00+00:00"}}, SUNDAY_NIGHT)
    assert rc.verify_clock_server({"kind": "uct-hub-sandbox"}, SUNDAY_NIGHT)


def test_without_the_launcher_a_clock_step_reads_inconclusive_with_the_reason():
    assert "clock-launcher" in rc.NEED_WHY["clock"]
    assert "SQLite" in rc.NEED_WHY["sql_clock"]
