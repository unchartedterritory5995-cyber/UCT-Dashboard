"""nyseCalendar.js (frontend, bundled) held to bars_fetch.py's/liveflow_monitor.py's
own independently hand-maintained NYSE calendar tables (backend).

Seam 7 (Dual NYSE Calendar Architecture Adjudication, 2026-09-07): Phase A found
all three of this repo's independent, hand-typed calendar tables (frontend
`nyseCalendar.js`, backend `bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD`, and a
previously-unrecorded third one in `voice_temporal_awareness.py`) already agree
on every overlapping date -- but nothing enforced that agreement; it was
discipline, not construction. This is that construction, for the two tables an
owner-authorized architecture decision kept as separate runtime-local datasets
(Option D: leave both, add a deterministic parity guard) rather than collapsing
into a single network-fetched authority (`useMarketCalendar.js`/
`GET /api/market-calendar` already does that for the ONE consumer -- the
Dashboard session pill -- that can tolerate the round trip; chart/session-state
needs zero-latency local truth, which is why `nyseCalendar.js` stays bundled).

⛔ THE JS SOURCE IS PARSED, NOT RE-TYPED. Retyping nyseCalendar.js's dates into
this file would just be a FOURTH hand-maintained copy -- the exact defect class
this test exists to catch. A regex read of the real file is fragile against a
genuine reformat, so `test_the_parser_itself_finds_a_nonempty_set_per_year`
guards against the parser silently extracting nothing and this test passing
vacuously green with zero real comparisons made.
"""
from __future__ import annotations

import pathlib
import re

import pytest

from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD
from api.services.liveflow_monitor import _NYSE_EARLY_CLOSES_YYYYMMDD
from api.services.nyse_calendar import (
    NYSE_EARLY_CLOSES_YYYYMMDD as _LEAF_EARLY_CLOSES,
    NYSE_HOLIDAYS_YYYYMMDD as _LEAF_HOLIDAYS,
)

_JS_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "app" / "src" / "lib" / "marketClock" / "nyseCalendar.js"
)

_DATE_RE = re.compile(r"date: '(\d{4}-\d{2}-\d{2})'")


def _js_source() -> str:
    return _JS_PATH.read_text(encoding="utf-8")


def _js_dates_for_export(export_name: str) -> set[str]:
    """Dates inside one `export const <export_name> = Object.freeze([...])`
    block, scoped to that block only (never the whole file) so a holidays
    export can't accidentally absorb an early-closes block below it."""
    src = _js_source()
    m = re.search(
        rf"export const {re.escape(export_name)} = Object\.freeze\(\[(.*?)\]\)",
        src, re.DOTALL,
    )
    assert m, f"{export_name} not found in nyseCalendar.js -- has it been renamed?"
    return set(_DATE_RE.findall(m.group(1)))


def _yyyymmdd_to_iso(dates: frozenset[int]) -> set[str]:
    return {f"{d // 10000:04d}-{(d // 100) % 100:02d}-{d % 100:02d}" for d in dates}


_BACKEND_HOLIDAYS_ISO = _yyyymmdd_to_iso(_NYSE_HOLIDAYS_YYYYMMDD)
_BACKEND_EARLY_CLOSES_ISO = _yyyymmdd_to_iso(_NYSE_EARLY_CLOSES_YYYYMMDD)

def _js_covered_years() -> tuple[int, ...]:
    """The years nyseCalendar.js DECLARES, read from its own ``COVERED_YEARS``.

    ⛔ DERIVED, NEVER RETYPED. This was a hand-typed ``(2026, 2027)`` sitting
    beside the ``COVERED_YEARS`` that owns it -- the repo's most-repeated defect
    (the writer-index ``FOUR``, the COT router's "4 routes", the setup catalog's
    "24"). It fails in the SILENT direction: add 2028 to nyseCalendar.js and the
    parity assertions below simply never run on it, so a brand-new year's dates
    -- the ones most likely to be wrong, because they were just hand-entered --
    are the ones nothing compares. The test would stay green and say nothing.
    """
    m = re.search(r"export const COVERED_YEARS = Object\.freeze\(\[([^\]]*)\]\)",
                  _js_source())
    assert m, "COVERED_YEARS not found in nyseCalendar.js -- has it been renamed?"
    return tuple(int(y) for y in re.findall(r"\d{4}", m.group(1)))


_FRONTEND_YEARS = _js_covered_years()


class TestTheParserItselfIsNotVacuous:
    """A regex is fragile against a genuine reformat of the JS file -- if it
    ever silently starts extracting nothing, every comparison below would
    pass with zero dates compared, which is a false green, not a real one."""

    @pytest.mark.parametrize("year", _FRONTEND_YEARS)
    def test_the_parser_itself_finds_a_nonempty_holiday_set_per_year(self, year):
        dates = _js_dates_for_export(f"NYSE_HOLIDAYS_{year}")
        assert len(dates) >= 8, (
            f"NYSE_HOLIDAYS_{year} parsed to only {len(dates)} dates -- "
            "either the file was reformatted in a way this parser can't read, "
            "or the table itself lost entries. Either way, investigate before "
            "trusting the parity assertions below."
        )

    def test_the_parser_finds_the_backend_tables_too(self):
        assert len(_BACKEND_HOLIDAYS_ISO) >= 20
        assert len(_BACKEND_EARLY_CLOSES_ISO) >= 3


class TestTheReExportIsTheLeafTheEngineActuallyReads:
    """⛔⛔ THE PARITY ABOVE CHECKS A RE-EXPORT; THE ENGINE READS THE LEAF.

    Both NYSE tables moved to the dependency-free leaf ``api/services/nyse_calendar.py``
    on 2026-09-09; ``bars_fetch`` and ``liveflow_monitor`` re-export them under
    their historical names so all 55 read sites kept working, and this file was
    deliberately left importing those names to prove exactly that.

    ⭐ BUT NOTHING PINNED THE TWO TOGETHER. ``ast_interpret`` imports the LEAF
    (``_nyse_full_closures`` / ``_nyse_early_closes``), so if a future edit gave
    ``bars_fetch`` its own literal again -- which is precisely the state the leaf
    refactor undid -- every assertion above would keep passing against a table the
    engine no longer reads, while the engine and the browser silently disagreed
    about which days the market is shut. A second authority over one value, with
    a green test standing over it.

    Identity, not equality: two equal frozensets built from two literals are the
    thing being forbidden, so ``==`` would accept the defect.
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


class TestFullHolidayParity:
    @pytest.mark.parametrize("year", _FRONTEND_YEARS)
    def test_frontend_and_backend_agree_on_every_full_holiday(self, year):
        frontend = _js_dates_for_export(f"NYSE_HOLIDAYS_{year}")
        backend = {d for d in _BACKEND_HOLIDAYS_ISO if d.startswith(str(year))}
        missing_from_backend = frontend - backend
        missing_from_frontend = backend - frontend
        assert not missing_from_backend, (
            f"nyseCalendar.js's NYSE_HOLIDAYS_{year} has dates bars_fetch.py's "
            f"_NYSE_HOLIDAYS_YYYYMMDD does not: {sorted(missing_from_backend)}"
        )
        assert not missing_from_frontend, (
            f"bars_fetch.py's _NYSE_HOLIDAYS_YYYYMMDD has {year} dates "
            f"nyseCalendar.js's NYSE_HOLIDAYS_{year} does not: "
            f"{sorted(missing_from_frontend)}"
        )


class TestEarlyCloseParity:
    @pytest.mark.parametrize("year", _FRONTEND_YEARS)
    def test_frontend_and_backend_agree_on_every_early_close(self, year):
        frontend = _js_dates_for_export(f"NYSE_EARLY_CLOSES_{year}")
        backend = {d for d in _BACKEND_EARLY_CLOSES_ISO if d.startswith(str(year))}
        assert frontend == backend, (
            f"Early-close mismatch for {year}: frontend={sorted(frontend)} "
            f"backend(liveflow_monitor)={sorted(backend)}"
        )


class TestNoFullHolidayIsAlsoAnEarlyClose:
    """A date cannot be both a full closure and a half day -- catches the
    exact class of subtlety these tables have to get right by hand every
    year (e.g. July 3 2026 is a full holiday because July 4 falls on a
    Saturday; Dec 24 2027 is a full holiday because Dec 25 falls on a
    Saturday -- neither is also listed as an early close)."""

    @pytest.mark.parametrize("year", _FRONTEND_YEARS)
    def test_frontend_holidays_and_early_closes_are_disjoint(self, year):
        holidays = _js_dates_for_export(f"NYSE_HOLIDAYS_{year}")
        early = _js_dates_for_export(f"NYSE_EARLY_CLOSES_{year}")
        assert not (holidays & early), (
            f"{year}: date(s) {sorted(holidays & early)} are listed as BOTH "
            "a full holiday and an early close in nyseCalendar.js"
        )
