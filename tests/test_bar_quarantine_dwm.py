"""Quarantine must work for D/W/M, and must be byte-identical for intraday.

⚰️ IT WAS A COMPLETE NO-OP FOR DAILY/WEEKLY/MONTHLY, and both halves failed in the
same direction, which is why no partial symptom ever surfaced:

  * the WRITE did ``int(bar["t"])`` inside a bare ``except: pass``
    (bars_disk_cache), so ``int("2026-09-11")`` raised and was swallowed — no
    daily row was ever written;
  * the READ compared that ISO string against a ``set[int]``, which can never
    match.

Fixing either alone would have left the feature dead. A bad daily bar the
validator flagged was therefore served from cache anyway.

⭐ The fix is key-ADDITIVE: ``norm_bar_time`` is IDENTITY for ints, so every
existing epoch-keyed row keeps matching and nothing is re-keyed. The intraday
tests below are the ones that prove that, and they are the reason this change is
safe to deploy without a live tape.

Mutation proof: make ``norm_bar_time`` return ``int(t)`` unconditionally (the old
behaviour) and the three D/W/M round-trip tests go RED while the intraday ones
stay green.
"""
from __future__ import annotations

import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
bq = importlib.import_module("api.services.bar_quarantine")


@pytest.fixture(autouse=True)
def _schema():
    bq.init_schema()
    yield


# ── the normaliser contract ──────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expect", [
    (1757606400, 1757606400),          # intraday epoch int -> IDENTITY
    (1757606400.0, 1757606400),        # float epoch
    ("1757606400", 1757606400),        # epoch that arrived as text
    ("2026-09-11", 20260911),          # daily ISO date
    ("2026-09-11T00:00:00", 20260911), # datetime form
    ("", None),
    ("garbage", None),
    (None, None),
    (True, None),                      # bool is an int subclass - must NOT key
])
def test_norm_bar_time_contract(raw, expect):
    assert bq.norm_bar_time(raw) == expect


def test_intraday_is_identity_which_is_why_nothing_is_rekeyed():
    """The load-bearing property. If this ever stops holding, every row already
    in the table silently stops matching and good bars start being served."""
    for epoch in (0, 1, 1757606400, 2_000_000_000):
        assert bq.norm_bar_time(epoch) is epoch or bq.norm_bar_time(epoch) == epoch


# ── round trips: the bug, per timeframe ──────────────────────────────────────

@pytest.mark.parametrize("tf,iso", [("D", "2026-09-11"),
                                    ("W", "2026-09-07"),
                                    ("M", "2026-09-01")])
def test_a_dwm_bar_can_be_quarantined_and_is_then_seen_as_quarantined(tf, iso):
    """RED on the old code: add() raised ValueError on the ISO string."""
    tkr = "ZZTEST" + tf
    bq.add(tkr, tf, iso, "synthetic spike")
    assert bq.is_quarantined(tkr, tf, iso) is True
    assert bq.norm_bar_time(iso) in bq.quarantined_times(tkr, tf)
    bq.remove(tkr, tf, iso)
    assert bq.is_quarantined(tkr, tf, iso) is False


@pytest.mark.parametrize("tf", ["1", "5", "15", "60"])
def test_intraday_round_trip_is_unchanged(tf):
    """The regression guard. Epoch keys must behave exactly as before."""
    tkr = "ZZINTRA" + tf
    epoch = 1757606400
    bq.add(tkr, tf, epoch, "synthetic spike")
    assert bq.is_quarantined(tkr, tf, epoch) is True
    assert epoch in bq.quarantined_times(tkr, tf)
    # an equivalent epoch passed as TEXT must hit the same row, not a second one
    assert bq.is_quarantined(tkr, tf, str(epoch)) is True
    assert len(bq.quarantined_times(tkr, tf)) == 1
    bq.remove(tkr, tf, epoch)
    assert bq.is_quarantined(tkr, tf, epoch) is False


def test_an_unkeyable_time_raises_rather_than_writing_a_wrong_key():
    """A wrong key filters a GOOD bar off a member's chart, which is worse than
    failing to quarantine a bad one. So this is loud, not silent."""
    with pytest.raises(ValueError):
        bq.add("ZZBAD", "D", "not-a-date", "junk")


def test_the_disk_cache_writer_normalises_instead_of_int_casting():
    """Source check: the old writer did int(bar["t"]) inside a bare except, so the
    ValueError was swallowed and no daily row was ever written. Nothing else in
    the test suite can observe a swallowed exception."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "api", "services", "bars_disk_cache.py"),
              encoding="utf-8") as fh:
        src = fh.read()
    # Scoped to the QUARANTINE writer. ⚠️ The identical pattern survives one line
    # above in `bar_provenance.record(ticker, tf, int(bar.get("t") or 0), source)`,
    # also inside a bare except, so DAILY PROVENANCE IS SILENTLY NEVER RECORDED
    # either. That is a different module and a different (observability) blast
    # radius, so it is logged rather than folded into this diff.
    assert "ticker, tf, _qt," in src, (
        "the quarantine writer no longer passes the NORMALISED key; if it is "
        "int()-casting bar['t'] again, an ISO daily date raises there and the "
        "bare except swallows it, so no daily row is ever written")
    assert "_qt = bar_quarantine.norm_bar_time(bar.get(\"t\"))" in src
    assert "if _qt is not None:" in src, (
        "an un-keyable time must SKIP rather than be guessed at")
    assert "bar_quarantine.norm_bar_time(bar.get(\"t\"))" in src
    assert "bar_quarantine.norm_bar_time(b.get(\"t\")) not in bad_times" in src, (
        "the read filter must normalise the bar's t before the membership test, "
        "or an ISO string can never match a set of ints")
