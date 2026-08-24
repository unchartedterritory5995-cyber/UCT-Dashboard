"""`pctAvgVol` — the value tests, not the behaviour tests.

Every one of the ~9,600 tests in this suite asserts what the code DOES.
`pct_avg30` shipped a 100x unit error and a fabricated `0` on 99.16% of
priced prints straight through all of them, because both defects are
statements about what a number SAYS. These are the missing kind: each
asserts the published figure against an oracle that is independent of the
code path producing it.

Two oracles are used, both free and both internal to the row:

  1. The vendor restates the same figure in its free-text ``message``
     ("DARK AVGPRC  $4.1M 334.49% AvgVol"). That is an independent
     restatement of the structured column, INSIDE THE SAME ROW.
  2. ``volume / avg30day`` recomputes it from first principles off two
     other columns of the same row.

The fixture rows below are REAL rows, copied verbatim from
``C:\\data\\darkpool.db`` on 2026-08-23 (date 6/12/2026 — the only session
in 105 that ever populated the column). Re-measured there:
``pct_avg30 == volume/avg30day`` exactly, 0 violations at 1e-9 relative on
1,377 of 1,377 populated rows, and ``message_pct == pct_avg30 * 100`` on
the same 1,377.
"""
import ast
import pathlib
import re

import pytest

from api import darkpool_db
from api.darkpool_db import (
    _cluster_prints_to_zones,
    _pct_avg_vol,
    _print_row,
)

_AVGVOL_RE = re.compile(r"([0-9][0-9,]*\.?[0-9]*)\s*%\s*AvgVol", re.I)

# (ticker, volume, avg30day, pct_avg30, message) — verbatim vendor rows.
VENDOR_ROWS = [
    ("IDRV", 100000.0, 29896.0, 3.344929087503345,
     "DARK AVGPRC  $4.1M 334.49% AvgVol"),
    ("IDEQ", 150000.0, 308141.0, 0.48679013828085194,
     "DARK AVGPRC  $5.3M 48.68% AvgVol"),
    ("SO", 3015668.0, 5845663.0, 0.5158812610306136,
     "DARK BLOCK  $283.0M 51.59% AvgVol"),
    ("CCL", 316167.0, 28920223.0, 0.010932384580851953,
     "DARK BLOCK  $9.2M 1.09% AvgVol"),
    ("LRCX", 108125.0, 9673400.0, 0.011177559079537701,
     "DARK BLOCK  $39.0M 1.12% AvgVol"),
    ("DOW", 575702.0, 11296724.0, 0.05096185407380051,
     "DARK BLOCK  $19.0M 5.1% AvgVol"),
]


def _row(pct_avg30, price=100.0, notional=4_000_000.0, volume=40_000.0):
    """A darkpool_trades SELECT tuple in the module's shared column order:
    date, timestamp, price, notional, pct_avg30, volume, type, message."""
    return ("6/12/2026", "10:30:00 AM", price, notional, pct_avg30, volume,
            "Block", "DARK BLOCK  $4.0M")


# ── 1. The scale: the column is a ratio, the API publishes a percent ──

@pytest.mark.parametrize("ticker,volume,avg30day,pct_avg30,message", VENDOR_ROWS)
def test_published_pct_matches_the_vendors_own_words(
        ticker, volume, avg30day, pct_avg30, message):
    """The vendor writes the figure twice per row. We must agree with the
    prose, which is the copy a member can actually read."""
    vendor_pct = float(_AVGVOL_RE.search(message).group(1))
    published = _print_row(_row(pct_avg30, volume=volume))["pctAvgVol"]
    # The message rounds to 2 decimals, so compare at the message's precision.
    assert published == pytest.approx(vendor_pct, abs=0.005 + abs(vendor_pct) * 1e-9), (
        f"{ticker}: published {published!r}, vendor's own message says "
        f"{vendor_pct}% — a 100x unit error renders a 3.3x volume event as '3%'"
    )


@pytest.mark.parametrize("ticker,volume,avg30day,pct_avg30,message", VENDOR_ROWS)
def test_published_pct_recomputes_from_volume_over_avg30day(
        ticker, volume, avg30day, pct_avg30, message):
    """Second, independent oracle: recompute the percent from two other
    columns of the same row. Catches a scale error even if the vendor ever
    stopped restating it in prose."""
    recomputed = volume / avg30day * 100.0
    published = _print_row(_row(pct_avg30, volume=volume))["pctAvgVol"]
    assert published == pytest.approx(recomputed, rel=1e-9), (
        f"{ticker}: published {published!r} vs volume/avg30day*100 = {recomputed}"
    )


def test_a_print_at_exactly_its_average_publishes_one_hundred():
    """The anchor of the unit. 100 means 'traded exactly its 30-day average
    volume' — the number the tooltip's `Math.round(x)%` renders."""
    assert _pct_avg_vol(1.0) == 100.0
    assert _pct_avg_vol(3.5) == 350.0   # matches darkpool_router's docstring


# ── 2. The fabricated zero: absent is not zero ────────────────────────

@pytest.mark.parametrize("absent", [None, "", 0, 0.0])
def test_an_unsupplied_figure_is_omitted_never_zeroed(absent):
    """⛔ A `0` here means 'this print was nothing special'. It sorts to the
    bottom of any ranking and reads False to every `> 0` filter, so it is
    indistinguishable from a real answer. 162,425 of 163,803 priced prints
    (99.16%) have no value; they must publish nothing, not zero."""
    assert _pct_avg_vol(absent) is None
    assert _print_row(_row(absent))["pctAvgVol"] is None


def test_the_zone_payload_does_not_re_fabricate_the_zero():
    """The zone clusterer carries the print's value forward. It used to
    re-apply `or 0` one layer AFTER the value had been correctly omitted —
    the fix has to hold at both boundaries or it holds at neither."""
    unknown = _print_row(_row(None, price=100.0))
    unknown["dateRaw"] = unknown["dateLong"] = unknown["date"] = "6/12/2026"
    zones = _cluster_prints_to_zones([unknown])
    assert len(zones) == 1
    assert zones[0]["pctAvgVol"] is None


def test_the_zone_payload_carries_the_percent_forward_unscaled():
    """And when the figure IS known, the zone must publish the same percent
    the print did — not a second multiply."""
    known = _print_row(_row(3.344929087503345))
    known["dateRaw"] = known["dateLong"] = known["date"] = "6/12/2026"
    zones = _cluster_prints_to_zones([known])
    assert zones[0]["pctAvgVol"] == pytest.approx(334.49, abs=0.005)


# ── 3. Structural rails: one conversion, one shaper, no `or 0` ────────

def _module_ast():
    src = pathlib.Path(darkpool_db.__file__).read_text(encoding="utf-8")
    return ast.parse(src), src


def test_the_unit_conversion_has_exactly_one_call_site():
    """One writer per value. A second `_pct_avg_vol(...)` — or a hand-copied
    `* 100` beside it — is a second authority over one number, which is this
    repo's most repeated defect."""
    tree, _ = _module_ast()
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Name)
             and n.func.id == "_pct_avg_vol"]
    assert len(calls) == 1, (
        f"_pct_avg_vol is called {len(calls)}x; the conversion must happen at "
        f"exactly one boundary (_print_row)"
    )


def test_no_pctavgvol_is_published_through_an_or_default():
    """The defect expressed as a SHAPE, so it can never come back under a
    different name. `x or 0` is an `ast.BoolOp(Or)`; forbidding it as the
    value of a `"pctAvgVol"` dict key outlaws the fabricated zero at every
    site in this module at once — including ones not written yet."""
    tree, _ = _module_ast()
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for key, value in zip(node.keys, node.values):
            if (isinstance(key, ast.Constant) and key.value == "pctAvgVol"
                    and isinstance(value, ast.BoolOp)
                    and isinstance(value.op, ast.Or)):
                offenders.append(node.lineno)
    assert offenders == [], (
        f"`pctAvgVol` published through an `or` default at line(s) {offenders} — "
        f"that is the fabricated zero. Omit the key's value instead."
    )


def test_get_ticker_prints_delegates_to_the_one_shaper():
    """`get_ticker_prints` used to carry a byte-identical copy of
    `_print_row`'s body. A copy means the next definition change lands in one
    of them — which is exactly how a unit fix gets half-applied."""
    tree, _ = _module_ast()
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "get_ticker_prints")
    builds_its_own = [n.lineno for n in ast.walk(fn)
                      if isinstance(n, ast.Dict)
                      and any(isinstance(k, ast.Constant) and k.value == "pctAvgVol"
                              for k in n.keys)]
    assert builds_its_own == [], (
        f"get_ticker_prints shapes its own print dict at line(s) {builds_its_own}; "
        f"it must delegate to _print_row"
    )
    assert any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
               and n.func.id == "_print_row" for n in ast.walk(fn)), \
        "get_ticker_prints no longer calls _print_row"


# ── 4. End-to-end through SQLite, not just the pure functions ─────────

def test_end_to_end_ingest_to_published_percent(tmp_path, monkeypatch):
    """The whole path a member's request takes: vendor CSV → SQLite →
    get_ticker_prints. A pure-function test cannot see the ingest dropping
    or rescaling the field on the way in."""
    monkeypatch.setattr(darkpool_db, "DB_DIR", str(tmp_path))
    monkeypatch.setattr(darkpool_db, "DB_PATH", str(tmp_path / "darkpool.db"))
    darkpool_db.init_db()

    csv_text = (
        ",".join(darkpool_db.CSV_COLUMNS) + "\n"
        # IDRV: the real 6/12/2026 row. 334.49% of its 30-day average.
        "6/12/2026,3:59:00 PM,IDRV,100000,41.0,3.344929087503345,4100000,"
        "DARK AVGPRC  $4.1M 334.49% AvgVol,Block,CS,,,29896,,\n"
        # A row the vendor left blank — the 99.16% case.
        "6/12/2026,3:58:00 PM,ZZZZ,50000,80.0,,4000000,"
        "DARK BLOCK  $4.0M,Block,CS,,,,,\n"
    )
    assert darkpool_db.insert_csv_rows(csv_text)["inserted"] == 2

    prints = {p["price"]: p for p in
              darkpool_db.get_ticker_prints("IDRV", days=30)}
    assert prints[41.0]["pctAvgVol"] == pytest.approx(334.49, abs=0.005)

    blank = darkpool_db.get_ticker_prints("ZZZZ", days=30)
    assert len(blank) == 1
    assert blank[0]["pctAvgVol"] is None, \
        "a blank vendor field must publish nothing, not 0"
