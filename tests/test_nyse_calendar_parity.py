"""nyseCalendar.js (frontend, bundled) and bars_fetch.py's/liveflow_monitor.py's
NYSE tables (backend) held to ONE dataset: ``market_calendar.json``.

Seam 7 (Dual NYSE Calendar Architecture Adjudication, 2026-09-07) found the
frontend ``nyseCalendar.js`` and the backend ``bars_fetch._NYSE_HOLIDAYS_YYYYMMDD``
were two independently hand-typed tables that happened to agree, and built this
file as the deterministic parity guard between them: it parsed the JS source's
date literals with a regex and compared them, year by year, to the backend set.

⭐ TERM-035 follow-up #1 (2026-09-28) REMOVED THE SECOND TABLE INSTEAD OF
GUARDING IT. Both sides now derive from
``app/src/lib/marketClock/market_calendar.json``:

* client  ``nyseCalendar.js`` -> ``sessionCalendar.js`` -> the JSON
* server  ``nyse_calendar.py`` -> ``session_calendar.py`` -> the JSON, and
  ``bars_fetch`` / ``liveflow_monitor`` re-export the leaf's objects.

So "both tables agree" became "both load the same JSON", and this file asserts
exactly that, in four parts:

1. THE CLIENT STAYS DERIVED. ``nyseCalendar.js`` reads ``./sessionCalendar``,
   which reads ``./market_calendar.json`` -- the file ``session_calendar.py``
   opens -- and ``nyseCalendar.js`` carries no ISO date literal outside a
   comment. A retyped table is the defect this file exists to catch, so the
   no-literal check has a control proving it fires on the old table's shape.
2. THE BACKEND EQUALS THE JSON, per year, read with ``json.load`` directly
   (not through ``session_calendar``), with a non-vacuity floor per year.
3. THE BACKEND ANSWERS THE SHARED FIXTURE. The derivation makes (2) close to
   a tautology, so the independent check is ``tests/fixtures/
   market_calendar_cases.json``: every day row and every in-RTH session row is
   answered by the backend sets themselves. The same fixture is answered on the
   client by ``sessionCalendar.test.js`` (including through
   ``marketClock.sessionState``), so a date removed from the JSON goes red on
   BOTH runtimes.
4. THE LEAF STAYS A LEAF, and the re-exports stay the leaf's objects.

⚰️ The regex parser this file used to carry
(``_js_dates_for_export``/``_js_covered_years``) was deleted with the literals
it parsed: once the JS derives, that parser finds nothing, and a parity test
over an empty set is the vacuous green it was built to prevent.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import session_calendar
from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD
from api.services.liveflow_monitor import _NYSE_EARLY_CLOSES_YYYYMMDD
from api.services.nyse_calendar import (
    NYSE_EARLY_CLOSES_YYYYMMDD as _LEAF_EARLY_CLOSES,
    NYSE_HOLIDAYS_YYYYMMDD as _LEAF_HOLIDAYS,
)

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_CLOCK_DIR = _ROOT / "app" / "src" / "lib" / "marketClock"
_JS_PATH = _CLOCK_DIR / "nyseCalendar.js"
_SESSION_JS_PATH = _CLOCK_DIR / "sessionCalendar.js"
_JSON_PATH = _CLOCK_DIR / "market_calendar.json"
_FIXTURE_PATH = _ROOT / "tests" / "fixtures" / "market_calendar_cases.json"
_LEAF_PATH = _ROOT / "api" / "services" / "nyse_calendar.py"
_SESSION_PY_PATH = _ROOT / "api" / "services" / "session_calendar.py"

_ET = ZoneInfo("America/New_York")

_RAW = json.loads(_JSON_PATH.read_text(encoding="utf-8"))
_FIXTURE = json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))

#: Every year the dataset claims, from its own coverage span -- never typed.
_DATASET_YEARS = tuple(range(int(_RAW["coverage_start"][:4]), int(_RAW["horizon"][:4]) + 1))


def _ymd(iso: str) -> int:
    return int(iso.replace("-", ""))


def _iso(yyyymmdd: int) -> str:
    return f"{yyyymmdd // 10000:04d}-{(yyyymmdd // 100) % 100:02d}-{yyyymmdd % 100:02d}"


_JSON_HOLIDAYS = {_ymd(h["date"]) for h in _RAW["holidays"]}
_JSON_EARLY_CLOSES = {_ymd(e["date"]) for e in _RAW["early_closes"]}


# --------------------------------------------------------------------------
# 1. The client stays derived
# --------------------------------------------------------------------------

_ISO_LITERAL = re.compile(r"""['"`]\d{4}-\d{2}-\d{2}['"`]""")


def _strip_js_comments(src: str) -> str:
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.DOTALL)
    return re.sub(r"(?m)//.*$", "", src)


def _iso_literals_in_code(src: str) -> list[str]:
    return _ISO_LITERAL.findall(_strip_js_comments(src))


class TestTheClientIsDerived:
    def test_nyseCalendar_js_imports_sessionCalendar(self):
        src = _JS_PATH.read_text(encoding="utf-8")
        assert re.search(r"""from\s+['"]\./sessionCalendar(\.js)?['"]""", src), (
            "nyseCalendar.js no longer imports ./sessionCalendar -- it has stopped "
            "deriving from market_calendar.json and is a second client calendar again."
        )

    def test_sessionCalendar_js_imports_the_json_the_backend_reads(self):
        src = _SESSION_JS_PATH.read_text(encoding="utf-8")
        assert re.search(r"""from\s+['"]\./market_calendar\.json['"]""", src)
        assert session_calendar.DATASET_PATH.resolve() == _JSON_PATH.resolve(), (
            "session_calendar.py opens a different file from the one the browser "
            f"bundles: {session_calendar.DATASET_PATH} vs {_JSON_PATH}"
        )

    def test_nyseCalendar_js_types_no_date(self):
        found = _iso_literals_in_code(_JS_PATH.read_text(encoding="utf-8"))
        assert not found, (
            f"nyseCalendar.js carries date literal(s) {found}: a retyped table beside "
            "market_calendar.json is a second authority over the same dates. Add "
            "dates to the JSON, never to this file."
        )

    def test_the_no_literal_check_can_fire(self):
        """Control: the check above must SEE the shape the file used to have,
        and must ignore a date that only appears in a comment."""
        old_shape = "export const X = Object.freeze([\n  { date: '2026-01-01', name: 'x' },\n])\n"
        assert _iso_literals_in_code(old_shape) == ["'2026-01-01'"]
        assert _iso_literals_in_code("// e.g. '2026-01-01'\n/* '2027-01-01' */\nconst a = 1\n") == []


# --------------------------------------------------------------------------
# 2. The backend equals the JSON
# --------------------------------------------------------------------------

class TestTheBackendEqualsTheDataset:
    def test_the_dataset_years_are_not_vacuous(self):
        assert len(_DATASET_YEARS) >= 4, _DATASET_YEARS

    @pytest.mark.parametrize("year", _DATASET_YEARS)
    def test_full_closures_equal_the_json(self, year):
        ours = {d for d in _JSON_HOLIDAYS if d // 10000 == year}
        theirs = {d for d in _NYSE_HOLIDAYS_YYYYMMDD if d // 10000 == year}
        assert len(ours) >= 8, f"{year}: the dataset lists only {len(ours)} closures"
        assert ours == theirs, (
            f"{year}: only in market_calendar.json {sorted(map(_iso, ours - theirs))}; "
            f"only in bars_fetch._NYSE_HOLIDAYS_YYYYMMDD {sorted(map(_iso, theirs - ours))}"
        )

    @pytest.mark.parametrize("year", _DATASET_YEARS)
    def test_half_days_equal_the_json(self, year):
        ours = {d for d in _JSON_EARLY_CLOSES if d // 10000 == year}
        theirs = {d for d in _NYSE_EARLY_CLOSES_YYYYMMDD if d // 10000 == year}
        assert ours == theirs, (
            f"{year}: only in market_calendar.json {sorted(map(_iso, ours - theirs))}; "
            f"only in liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD {sorted(map(_iso, theirs - ours))}"
        )

    def test_nothing_in_the_backend_falls_outside_the_dataset(self):
        assert not (_NYSE_HOLIDAYS_YYYYMMDD - _JSON_HOLIDAYS)
        assert not (_NYSE_EARLY_CLOSES_YYYYMMDD - _JSON_EARLY_CLOSES)

    def test_every_early_close_is_13_00(self):
        """The backend's half-day set is a set of dates: it cannot carry a close
        time, and every reader of it assumes 13:00 ET. A dataset row closing at
        any other time would be silently read as 13:00 on the server."""
        odd = [e for e in _RAW["early_closes"] if e["close"] != "13:00"]
        assert not odd, f"early closes not at 13:00 ET: {odd}"

    @pytest.mark.parametrize("year", _DATASET_YEARS)
    def test_no_full_holiday_is_also_an_early_close(self, year):
        both = {d for d in _JSON_HOLIDAYS & _JSON_EARLY_CLOSES if d // 10000 == year}
        assert not both, f"{year}: {sorted(map(_iso, both))} are both a closure and a half-day"


# --------------------------------------------------------------------------
# 3. The backend answers the shared fixture (the independent check)
# --------------------------------------------------------------------------

def _backend_closed_all_day(d: date) -> bool:
    return d.weekday() >= 5 or int(d.strftime("%Y%m%d")) in _NYSE_HOLIDAYS_YYYYMMDD


def _mid_rth_session_rows():
    """Session rows at an ET wall time between 09:30 and 13:00 -- inside RTH on
    every trading day, half-days included -- so 'closed' there means only one
    thing: the whole day is shut."""
    rows = []
    for c in _FIXTURE["sessions"]:
        et = datetime.fromisoformat(c["ts"].replace("Z", "+00:00")).astimezone(_ET)
        m = et.hour * 60 + et.minute
        if 9 * 60 + 30 <= m < 13 * 60:
            rows.append((c["ts"], et.date(), c["expect"], c["why"]))
    return rows


_MID_RTH_ROWS = _mid_rth_session_rows()


class TestTheBackendAnswersTheSharedFixture:
    def test_the_fixture_comparison_is_not_vacuous(self):
        assert len(_FIXTURE["days"]) >= 15
        assert len(_MID_RTH_ROWS) >= 15
        assert any(not c["trading_day"] for c in _FIXTURE["days"])
        assert any(d.year == int(_RAW["horizon"][:4]) and want == "closed" and d.weekday() < 5
                   for _, d, want, _ in _MID_RTH_ROWS), "no horizon-year holiday row to compare"

    @pytest.mark.parametrize("row", _FIXTURE["days"], ids=lambda c: c["date"])
    def test_day_rows(self, row):
        d = date.fromisoformat(row["date"])
        assert (not _backend_closed_all_day(d)) is row["trading_day"], row["why"]
        if row["close_utc"] is not None:
            close_et = datetime.fromisoformat(row["close_utc"].replace("Z", "+00:00")).astimezone(_ET)
            is_half = int(d.strftime("%Y%m%d")) in _NYSE_EARLY_CLOSES_YYYYMMDD
            assert is_half is (close_et.hour == 13), (
                f"{row['date']}: fixture closes at {close_et:%H:%M} ET but the backend "
                f"half-day set says {'half-day' if is_half else 'full day'} ({row['why']})"
            )

    @pytest.mark.parametrize("row", _MID_RTH_ROWS, ids=lambda r: r[0])
    def test_mid_rth_session_rows(self, row):
        ts, d, want, why = row
        assert _backend_closed_all_day(d) is (want == "closed"), f"{ts}: {why}"


# --------------------------------------------------------------------------
# 4. The leaf stays a leaf; the re-exports stay the leaf's objects
# --------------------------------------------------------------------------

def _imported_modules(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
    return out


class TestTheLeafStaysALeaf:
    """``nyse_calendar`` exists so ``ast_interpret`` and ``scan_evaluator`` can
    read the two sets without importing a service. Deriving it from
    ``session_calendar`` keeps that only while ``session_calendar`` is itself
    stdlib-only."""

    def test_nyse_calendar_imports_only_session_calendar_from_api(self):
        api_imports = {m for m in _imported_modules(_LEAF_PATH) if m.startswith("api")}
        assert api_imports == {"api.services.session_calendar"}, api_imports

    def test_session_calendar_imports_nothing_from_api(self):
        api_imports = {m for m in _imported_modules(_SESSION_PY_PATH) if m.startswith("api")}
        assert not api_imports, (
            f"session_calendar.py imports {api_imports}: nyse_calendar is no longer "
            "a dependency-free leaf, and every reader of it now drags a service in."
        )

    def test_the_import_probe_can_see_an_api_import(self):
        """Control: the probe must see an api.* import where one exists."""
        assert "api.services.session_calendar" in _imported_modules(_LEAF_PATH)


class TestTheReExportIsTheLeafTheEngineActuallyReads:
    """⛔⛔ THE PARITY ABOVE CHECKS A RE-EXPORT; THE ENGINE READS THE LEAF.

    Both NYSE tables moved to the dependency-free leaf ``api/services/nyse_calendar.py``
    on 2026-09-09; ``bars_fetch`` and ``liveflow_monitor`` re-export them under
    their historical names so all 55 read sites kept working.

    ⭐ Identity, not equality: two equal frozensets built from two sources are
    the thing being forbidden, so ``==`` would accept the defect.
    """

    def test_bars_fetch_reexports_the_very_same_holiday_object(self):
        assert _NYSE_HOLIDAYS_YYYYMMDD is _LEAF_HOLIDAYS, (
            "bars_fetch._NYSE_HOLIDAYS_YYYYMMDD is no longer the leaf's object. "
            "If it has grown its own literal, the engine (which reads "
            "api/services/nyse_calendar.py) and this parity test are now looking "
            "at two different calendars."
        )

    def test_liveflow_monitor_reexports_the_very_same_early_close_object(self):
        assert _NYSE_EARLY_CLOSES_YYYYMMDD is _LEAF_EARLY_CLOSES, (
            "liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD is no longer the leaf's "
            "object -- see the sibling test above for why that is not cosmetic."
        )


# --------------------------------------------------------------------------
# 5. The TradingView view: one set of vendor facts, two runtimes, derived
# --------------------------------------------------------------------------

_TV_JS_PATH = _CLOCK_DIR / "tradingViewSession.js"
_TV_PY_PATH = _ROOT / "api" / "services" / "tradingview_session.py"

#: A plain-node ESM driver that can import a module that imports JSON
#: (``sessionCalendar.js`` does) -- the loader hook ``test_ast_interpret`` uses.
_JSON_HOOK = (
    "import { register } from 'node:module'\n"
    "register('data:text/javascript,"
    "import%20%7B%20readFile%20%7D%20from%20%27node%3Afs/promises%27%3B"
    "export%20async%20function%20load(u%2Cc%2Cn)%7Bif(u.endsWith(%27.json%27))"
    "%7Bconst%20s%3Dawait%20readFile(new%20URL(u)%2C%27utf8%27)%3B"
    "return%7Bformat%3A%27module%27%2CshortCircuit%3Atrue%2C"
    "source%3A%60export%20default%20%24%7Bs%7D%60%7D%7Dreturn%20n(u%2Cc)%7D')\n"
)


def _js_string_const(name: str) -> str:
    m = re.search(rf"export const {re.escape(name)} = '([^']*)'",
                  _TV_JS_PATH.read_text(encoding="utf-8"))
    assert m, f"{name} not found in tradingViewSession.js -- has it been renamed?"
    return m.group(1)


def _js_dates_in_export(name: str) -> set[int]:
    m = re.search(rf"export const {re.escape(name)} = Object\.freeze\(\[(.*?)\]\)",
                  _TV_JS_PATH.read_text(encoding="utf-8"), re.DOTALL)
    assert m, f"{name} not found in tradingViewSession.js -- has it been renamed?"
    return {_ymd(d) for d in re.findall(r"date: '(\d{4}-\d{2}-\d{2})'", m.group(1))}


class TestTheTradingViewViewIsOneFactInTwoFiles:
    """⭐ WHAT THE VENDOR'S SESSION APPLIES (the C8 ``time_close`` lane) -- four
    measured facts per runtime, compared, and the DERIVED views compared too, so
    a JS derivation that drifted from the Python one (a ``>`` for a ``>=``)
    cannot hide behind equal inputs. The NYSE dates themselves come from the
    dataset on both sides; only the vendor's exceptions are typed, once each."""

    def test_the_two_floors_agree(self):
        from api.services import tradingview_session as tv
        assert _ymd(_js_string_const("TRADINGVIEW_CLOSURES_FROM")) == tv.TRADINGVIEW_CLOSURES_FROM_YYYYMMDD
        assert _ymd(_js_string_const("TRADINGVIEW_EARLY_CLOSES_FROM")) == tv.TRADINGVIEW_EARLY_CLOSES_FROM_YYYYMMDD

    def test_the_two_exception_lists_agree_and_name_real_nyse_dates(self):
        from api.services import tradingview_session as tv
        js_c = _js_dates_in_export("TRADINGVIEW_UNAPPLIED_CLOSURES")
        js_e = _js_dates_in_export("TRADINGVIEW_UNAPPLIED_EARLY_CLOSES")
        assert js_c == set(tv.TRADINGVIEW_UNAPPLIED_CLOSURES_YYYYMMDD) and len(js_c) == 6
        assert js_e == set(tv.TRADINGVIEW_UNAPPLIED_EARLY_CLOSES_YYYYMMDD) and len(js_e) == 2
        # an exception must name a date the DATASET holds, or it subtracts nothing
        # and reads as a rule that was applied
        assert js_c <= _JSON_HOLIDAYS
        assert js_e <= _JSON_EARLY_CLOSES

    def test_the_vendor_view_reads_the_nyse_dates_through_the_one_calendar(self):
        assert re.search(r"""from\s+['"]\./sessionCalendar(\.js)?['"]""",
                         _TV_JS_PATH.read_text(encoding="utf-8"))
        api_imports = {m for m in _imported_modules(_TV_PY_PATH) if m.startswith("api.")}
        assert api_imports == {"api.services.nyse_calendar"}, api_imports

    def test_the_js_derivation_of_the_vendor_view_equals_the_python_one(self):
        import shutil
        import subprocess
        from api.services import tradingview_session as tv
        node = shutil.which("node")
        assert node, "node is required for this rail; a skipped cross-lane rail rots"
        prog = _JSON_HOOK + (
            "import { pathToFileURL } from 'node:url'\n"
            f"const m = await import(pathToFileURL({json.dumps(str(_TV_JS_PATH))}).href)\n"
            "const out = {closures: [], early: []}\n"
            "for (let y = 1993; y <= 2029; y++) for (let mo = 1; mo <= 12; mo++)\n"
            " for (let d = 1; d <= 31; d++) {\n"
            "  const k = y * 10000 + mo * 100 + d\n"
            "  const dt = new Date(Date.UTC(y, mo - 1, d))\n"
            "  if (dt.getUTCMonth() !== mo - 1) continue\n"
            "  const dow = dt.getUTCDay(); if (dow === 0 || dow === 6) continue\n"
            "  const c = m.tradingViewCloseMinute(k)\n"
            "  if (c === null) out.closures.push(k); else if (c === 780) out.early.push(k)\n"
            " }\n"
            "process.stdout.write(JSON.stringify(out))\n"
        )
        res = subprocess.run([node, "--input-type=module", "-e", prog], cwd=str(_ROOT),
                             capture_output=True, text=True, encoding="utf-8", timeout=120)
        assert res.returncode == 0, res.stderr[-2000:]
        got = json.loads(res.stdout)
        # non-vacuity: the sweep SAW the vendor view, not an empty one
        assert len(got["closures"]) > 200 and len(got["early"]) >= 13
        assert set(got["closures"]) == set(tv.TRADINGVIEW_CLOSURES_YYYYMMDD)
        assert set(got["early"]) == set(tv.TRADINGVIEW_EARLY_CLOSES_YYYYMMDD)
        for k in got["closures"][:40] + got["early"]:
            assert tv.tradingview_close_minute(k) == (None if k in got["closures"] else 780), k
