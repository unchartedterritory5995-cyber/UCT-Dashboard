"""Daily/weekly/monthly provenance was never recorded. Same bug, second instance.

⚰️ `7500777a2` fixed the quarantine writer and deliberately LEFT this one, one line
above it in the same `try:` block, with its shape written into that commit message
and into `test_bar_quarantine_dwm.py`:

    bar_provenance.record(ticker, tf, int(bar.get("t") or 0), source)

`int("2026-09-11")` raises `ValueError`, the bare `except: pass` swallows it, and no
daily/weekly/monthly provenance row has ever been written. Every intraday bar records
fine, so `count_by_source()` has always looked healthy — the failure is invisible from
every surface that reads this table.

⭐ Same key-ADDITIVE fix, same single boundary: `bar_quarantine.norm_bar_time` is
IDENTITY for ints, so every existing epoch-keyed row keeps its key and nothing is
re-keyed. An un-keyable time SKIPS rather than guesses — and skipping is strictly
better than the old `or 0`, which wrote a meaningless row at `bar_time = 0` whenever
`t` was absent.

⚠️ Blast radius is OBSERVABILITY, not correctness: nothing on a member's chart reads
this table. That is why the un-keyable case skips silently here rather than raising as
`bar_quarantine._key` does — a raise inside a bare `except` is just the old silence
wearing a different hat.

Mutation proof: restore `int(bar.get("t") or 0)` at the call site and the three D/W/M
tests go RED while the four intraday ones stay green.
"""
from __future__ import annotations

import importlib
import io
import os
import sys
import tokenize

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
bp = importlib.import_module("api.services.bar_provenance")
bq = importlib.import_module("api.services.bar_quarantine")
bdc = importlib.import_module("api.services.bars_disk_cache")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_WRITER = os.path.join(_ROOT, "api", "services", "bars_disk_cache.py")


@pytest.fixture(autouse=True)
def _schema():
    bp.init_schema()
    yield


def _bar(t):
    """A bar the validator passes, so `put` reaches the provenance call."""
    return {"t": t, "o": 10.0, "h": 10.4, "l": 9.8, "c": 10.2, "v": 1_000_000}


def _put(ticker, tf, t, source="massive"):
    bdc.put(ticker, tf, 500, {"source": source, "bars": [_bar(t)]})


# ── the bug, per timeframe ───────────────────────────────────────────────────

@pytest.mark.parametrize("tf,iso,key", [("D", "2026-09-11", 20260911),
                                        ("W", "2026-09-07", 20260907),
                                        ("M", "2026-09-01", 20260901)])
def test_a_dwm_bar_gets_a_provenance_row(tf, iso, key):
    """RED on the old code: int(iso) raised and the bare except swallowed it, so
    the row was never written and `get` returned None."""
    tkr = "ZZPROV" + tf
    _put(tkr, tf, iso, source="massive")
    row = bp.get(tkr, tf, key)
    assert row is not None, (
        "no provenance row for a clean %s bar at %s — the writer is int()-casting "
        "the ISO date again and the bare except is hiding the ValueError" % (tf, iso))
    assert row["source"] == "massive"
    assert row["bar_time"] == key


# ── the regression guard: intraday must be byte-identical ────────────────────

@pytest.mark.parametrize("tf", ["1", "5", "15", "60"])
def test_intraday_provenance_is_unchanged(tf):
    """The load-bearing safety property. norm_bar_time is identity for ints, so an
    epoch key is recorded exactly where it always was — no re-keying, no migration."""
    tkr = "ZZPROVI" + tf
    epoch = 1757606400
    _put(tkr, tf, epoch, source="massive")
    row = bp.get(tkr, tf, epoch)
    assert row is not None and row["bar_time"] == epoch
    assert row["source"] == "massive"


def test_a_blank_time_writes_nothing_instead_of_a_row_at_zero():
    """RED on the old code, and the reason it is reachable at all is a surprise.

    ⚠️ `validate_bar` does NOT parse `t` — measured: `t: ""` and `t: "garbage"` both
    return `(True, [])`. So a bar with a blank time passes validation, is cached, and
    reaches this writer, where `int("" or 0)` wrote a provenance row keyed **0** — a
    record no reader can attribute to any bar, sitting in the same table as real ones.
    A missing `t` is the only form validation rejects.

    Skipping is the honest answer; a guessed key is worse than no key.
    """
    tkr = "ZZPROVBLANK%d" % os.getpid()
    # Control: the writer IS reached for this ticker/tf, so the assertion below
    # cannot pass by the writer simply never running.
    _put(tkr, "D", "2026-09-11")
    assert bp.get(tkr, "D", 20260911) is not None

    _put(tkr, "D", "")
    assert bp.get(tkr, "D", 0) is None, (
        "a blank bar time was written as key 0 instead of being skipped")


# ── source check: the call site actually normalises ──────────────────────────

def _code_only(src: str) -> str:
    """`src` with every comment removed and all other layout preserved.

    ⛔ A literal-hunting check that reads comments reports a property of the PROSE
    as a property of the code. `bars_disk_cache.py` now carries a comment beside
    this very writer explaining the defect, so an unstripped scan would match the
    thing it hunts.

    ⚠️ It truncates each line at its comment token rather than re-emitting tokens:
    `tokenize.untokenize` and a naive token join both destroy the spacing the
    needles below are written in, which makes every one of them fail against
    correct code — a check that cannot pass is as useless as one that cannot fail.
    """
    lines = src.splitlines()
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.COMMENT:
            row, col = tok.start
            lines[row - 1] = lines[row - 1][:col]
    return "\n".join(lines)


def test_the_comment_stripper_can_tell_code_from_prose():
    """The control, both ways. Without the first assertion the absence checks below
    would match prose; without the second, `_code_only` could return "" (or mangled
    spacing) and every presence check would fail against correct code."""
    sample = (
        'x = 1  # bar_provenance.record(ticker, tf, int(bar.get("t") or 0), source)\n'
        '_pt = bar_quarantine.norm_bar_time(bar.get("t"))\n'
    )
    stripped = _code_only(sample)
    assert 'int(bar.get("t") or 0)' not in stripped, "a comment was matched as code"
    assert '_pt = bar_quarantine.norm_bar_time(bar.get("t"))' in stripped, (
        "real code was destroyed or re-spaced by the stripper")


def test_the_provenance_writer_normalises_instead_of_int_casting():
    with open(_WRITER, encoding="utf-8") as fh:
        code = _code_only(fh.read())
    assert '_pt = bar_quarantine.norm_bar_time(bar.get("t"))' in code, (
        "the provenance writer no longer normalises the bar's t at the boundary")
    assert "if _pt is not None:" in code, (
        "an un-keyable time must SKIP rather than be written as some guessed key")
    assert "bar_provenance.record(ticker, tf, _pt, source)" in code, (
        "the normalised key is computed but not passed — the 'routing computed "
        "but never applied' failure this repo keeps rediscovering")
    assert 'int(bar.get("t") or 0)' not in code, (
        "the defective cast is back; inside a bare except it is silent, so no "
        "other test in this suite can observe it")
