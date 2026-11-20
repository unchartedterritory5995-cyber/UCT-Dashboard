"""Split-heal guards F3a / F3b' / F3c (2026-11-20). Synthetic fixtures only: the shapes are measured, the
numbers are stand-ins (the repo is public; no vendor rows here).

WHAT WENT WRONG, measured on production 2026-11-20.
- The serve-time heal rescaled CORRECT series. The one detector (`unadjusted_splits`) accepts a declared
  split when `|observed/r - 1| <= _SPLIT_TOL` (15% of r). For a small r that admits an ordinary down day:
  - BBD: 1.2 declared, a 6.4% and a 4.4% down day matched, so 2002-2019 were served x1/1.2 and x1/1.44.
  - CIG: 1.25 declared, so 1996-2012 were served x0.8.
  - HUBB: 4:3 declared, a 1.1675 step between two zero-volume stale quotes matched, so 1977 was served x0.75.
- The rebuilt series re-ran the heal over splits the rebuild had already applied (its stated purpose is
  splits AFTER the rebuild's end).

THE GUARDS
- F3b' (one detector, every path): the observed step must ALSO satisfy
  `|ln(observed / r)| <= _SPLIT_SIZE_TOL * |ln r|`. That is a band sized by the split itself, ANDed with
  today's band, so it is never looser. A candidate the old band accepted and this one rejects is
  REPORTED (`declined`) and logged by name.
- F3a (rebuilt series): only declared splits dated after the manifest's `end` are healed.
- F3c (one detector): a zero-volume bar is never step evidence. The detector bridges over it to the
  previous bar that traded, so a filler right before a real split still shows the split.

THE STATED COST (pinned below, a decision, not an accident): a genuinely unadjusted small split whose
session also moved more than r**0.25 (1.2 -> 4.66%) is declined, and logged.
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import logging
import math

import pytest

from api.services import bars_rebuild as R
from api.services import bars_sanitize as S


def _days(n, start="2024-01-02"):
    out, d = [], dt.date.fromisoformat(start)
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


DAYS = _days(40)


def _bars(closes, vols=None):
    vols = vols or [1000] * len(closes)
    return [{"t": t, "o": c, "h": c, "l": c, "c": c, "v": v} for t, c, v in zip(DAYS, closes, vols)]


def _wiggle(n, base=10.0):
    """Ordinary sessions: under 1% a day, never near any split band."""
    out, c = [], base
    for i in range(n):
        c = c * (1.004 if i % 2 else 0.996)
        out.append(round(c, 4))
    return out


def _old_band_accepts(obs, r):
    return abs(obs / r - 1.0) <= S._SPLIT_TOL


# ── F3b': kept (controls) ───────────────────────────────────────────────────────────────────────────────
def test_dd_reverse_split_found_four_sessions_before_its_declared_date_is_kept():
    closes = [47.95] * 18 + [143.13] * 22                      # 47.95 / 143.13 = 0.33501, r = 1/3
    bars = _bars(closes)
    found = S.unadjusted_splits(bars, [(DAYS[22], 1 / 3)])      # declared 4 sessions late, like FMP's DD row
    assert [(d.isoformat(), round(r, 4)) for d, r in found] == [(DAYS[18], round(1 / 3, 4))]


def test_mnst_two_for_one_the_vendor_missed_is_kept():
    closes = [80.0] * 20 + [41.0] * 20                          # obs 1.951 against r = 2
    found = S.unadjusted_splits(_bars(closes), [(DAYS[20], 2.0)])
    assert [d.isoformat() for d, _r in found] == [DAYS[20]]


def test_axia_exact_declared_factor_is_kept():
    closes = [12.6284] * 20 + [10.0] * 20
    found = S.unadjusted_splits(_bars(closes), [(DAYS[20], 1.26284)])
    assert [d.isoformat() for d, _r in found] == [DAYS[20]]


def test_a_three_for_two_with_a_small_concurrent_move_is_kept():
    closes = [14.9] * 20 + [10.0] * 20                          # obs 1.49 against r = 1.5
    found = S.unadjusted_splits(_bars(closes), [(DAYS[20], 1.5)])
    assert [d.isoformat() for d, _r in found] == [DAYS[20]]


def test_abtc_one_for_fifteen_reverse_split_is_kept():
    closes = [2.0] * 20 + [30.0] * 20                           # obs 0.0667 against r = 1/15
    found = S.unadjusted_splits(_bars(closes), [(DAYS[20], 1 / 15)])
    assert [d.isoformat() for d, _r in found] == [DAYS[20]]


# ── F3b': declined (the false heals measured in production) ─────────────────────────────────────────────
def _with_step(i, obs, n=40):
    """Ordinary sessions with ONE down day of size `obs` (close[i-1]/close[i]) at index i."""
    c = _wiggle(n)
    out = c[:i] + [round(c[i - 1] / obs, 4)]
    tail = _wiggle(n - i - 1, base=out[-1])
    return out + tail


@pytest.mark.parametrize("name,r,obs", [
    ("BBD 2019-03-22: 1.2 declared, a 6.4% down day six sessions early", 1.2, 1.064),
    ("BBD 2015-03-19: 1.2 declared, a 4.4% down day six sessions early", 1.2, 1.044),
    ("CIG 2012-05-14: 1.25 declared, a 7% down day inside the window", 1.25, 1.07),
    ("HUBB 1977-08-09: 4:3 declared, a 1.1675 step (here WITH volume)", 4 / 3, 1.1675),
])
def test_an_ordinary_move_inside_the_old_band_is_declined_and_reported(name, r, obs):
    closes = _with_step(16, obs)
    bars = _bars(closes)
    seen = closes[15] / closes[16]
    assert _old_band_accepts(seen, r), f"precondition ({name}): the old band matched, so this was a live false heal"
    declined = []
    assert S.unadjusted_splits(bars, [(DAYS[22], r)], declined=declined) == [], name
    assert len(declined) == 1, name
    d = declined[0]
    assert d["declared"] == DAYS[22] and d["ratio"] == pytest.approx(r) and d["at"] == DAYS[16]
    assert d["observed"] == pytest.approx(seen, rel=1e-9)


def test_the_stated_cost_is_pinned_at_r_to_the_quarter():
    """1.2 ** 0.25 = 1.04664: a real unadjusted 1.2 with a 4.6% concurrent move is still healed, with 4.7% it
    is declined (and reported). Moving _SPLIT_SIZE_TOL moves this edge; this test names where it is."""
    assert S._SPLIT_SIZE_TOL == 0.25
    edge = 1.2 ** S._SPLIT_SIZE_TOL
    assert edge == pytest.approx(1.04664, abs=1e-5)
    kept = _bars([12.0 * 1.046] * 20 + [10.0] * 20)            # obs = 1.2 * 1.046
    assert len(S.unadjusted_splits(kept, [(DAYS[20], 1.2)])) == 1
    declined = []
    lost = _bars([12.0 * 1.047] * 20 + [10.0] * 20)            # obs = 1.2 * 1.047
    assert S.unadjusted_splits(lost, [(DAYS[20], 1.2)], declined=declined) == []
    assert len(declined) == 1 and declined[0]["observed"] == pytest.approx(1.2 * 1.047, rel=1e-6)


def test_the_size_band_is_never_looser_than_the_old_band():
    """For a large split |ln r|/4 is wider than 15% of r: the AND keeps today's band the binding one."""
    closes = [100.0] * 20 + [100.0 / (3.0 * 1.2)] * 20         # obs 3.6 against r = 3: 20% off, old band rejects
    assert not _old_band_accepts(3.6, 3.0)
    assert abs(math.log(3.6 / 3.0)) <= S._SPLIT_SIZE_TOL * abs(math.log(3.0))   # the size band alone would accept
    assert S.unadjusted_splits(_bars(closes), [(DAYS[20], 3.0)]) == []


# ── F3c: zero-volume bars are not evidence ──────────────────────────────────────────────────────────────
def test_a_step_between_zero_volume_stale_quotes_is_not_evidence():
    """HUBB 1977: flat zero-volume fillers. Here the step is an EXACT 4:3, so only F3c can refuse it."""
    closes = [3.7271] * 20 + [2.7953] * 20
    found = S.unadjusted_splits(_bars(closes, [0] * 40), [(DAYS[20], 4 / 3)])
    assert found == []


def test_the_same_step_with_volume_is_detected():
    """The control: the refusal above is the volume rule, not the ratio rule."""
    closes = [3.7271] * 20 + [2.7953] * 20
    found = S.unadjusted_splits(_bars(closes), [(DAYS[20], 4 / 3)])
    assert [d.isoformat() for d, _r in found] == [DAYS[20]]


def test_a_zero_volume_filler_right_before_a_real_split_is_bridged():
    """A filler carries the previous close. The split day is compared with the last bar that TRADED."""
    closes = [100.0] * 19 + [100.0] + [50.0] * 20
    vols = [1000] * 19 + [0] + [1000] * 20
    found = S.unadjusted_splits(_bars(closes, vols), [(DAYS[20], 2.0)])
    assert [d.isoformat() for d, _r in found] == [DAYS[20]]


def test_a_missing_volume_is_unknown_not_zero():
    """Session closes built from intraday bars carry no volume: they stay evidence."""
    bars = [{"t": t, "c": c} for t, c in zip(DAYS, [80.0] * 20 + [40.0] * 20)]
    assert len(S.unadjusted_splits(bars, [(DAYS[20], 2.0)])) == 1


# ── F3a: the rebuilt series is the authority before its end ─────────────────────────────────────────────
RB_DAYS = _days(80, start="2003-09-10")
RB_END = RB_DAYS[59]


@pytest.fixture()
def rebuilt(tmp_path, monkeypatch):
    """A rebuilt ASB with a REAL -25% session (32 -> 24) on RB_DAYS[30], before the rebuild's end."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv(R.ENV_SERVE, raising=False)
    d = tmp_path / "bars_rebuild" / "v3"
    d.mkdir(parents=True)
    rows = [[t, 32.0, 32.0, 32.0, 32.0, 100] if i < 30 else [t, 24.0, 24.0, 24.0, 24.0, 100]
            for i, t in enumerate(RB_DAYS[:60])]
    (d / "ASB.json.gz").write_bytes(gzip.compress(json.dumps({"sym": "ASB", "end": RB_END, "bars": rows}).encode()))
    (tmp_path / "bars_rebuild" / "manifest.json").write_text(
        json.dumps({"version": 3, "end": RB_END, "symbols": ["ASB"]}))
    R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
    R._cache.clear()
    assert R.load_local()
    monkeypatch.setattr(S, "_reaches_store_head", lambda t, b, tf: True)
    monkeypatch.setattr(S, "split_adjust_active", lambda: True)
    monkeypatch.setattr(S, "_schedule_store_repair", lambda t, tf: None)
    yield
    R._state.update(version=0, end=None, symbols=frozenset(), loaded=False)
    R._cache.clear()


def _stored_asb(after_close=24.0):
    return [{"t": t, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 100} for t in RB_DAYS[:60]] + \
           [{"t": t, "o": after_close, "h": after_close, "l": after_close, "c": after_close, "v": 100}
            for t in RB_DAYS[60:]]


def test_a_declared_split_before_the_rebuild_end_is_not_reapplied(rebuilt, monkeypatch):
    """The step is an exact 4:3, so the detector alone WOULD heal it. The rebuild already carries every split
    up to its end: before `end` it is the authority."""
    monkeypatch.setattr(S, "_meta_cached", lambda t: {"ipo": None, "splits": [(RB_DAYS[30], 4 / 3)]})
    out = S.sanitize_daily_bars("ASB", _stored_asb(), "D")
    assert [b["c"] for b in out[:60]] == [32.0] * 30 + [24.0] * 30


def test_a_declared_split_after_the_rebuild_end_is_still_healed(rebuilt, monkeypatch):
    """The control (9641f59eb5's purpose): the store's bars after a later 2:1 are on the new basis."""
    monkeypatch.setattr(S, "_meta_cached", lambda t: {"ipo": None, "splits": [(RB_DAYS[60], 2.0)]})
    out = S.sanitize_daily_bars("ASB", _stored_asb(after_close=12.0), "D")
    assert [b["c"] for b in out[:60]] == [16.0] * 30 + [12.0] * 30
    assert [b["c"] for b in out[60:]] == [12.0] * 20


# ── the declined heal is logged by name, once ───────────────────────────────────────────────────────────
def test_a_declined_heal_on_the_stored_path_is_logged_by_name_once(monkeypatch, caplog):
    closes = _with_step(16, 1.064)
    monkeypatch.setattr(S, "_ENABLED", True)
    monkeypatch.setattr(S, "_meta_cached", lambda t: {"ipo": None, "splits": [(DAYS[22], 1.2)]})
    monkeypatch.setattr(S, "split_adjust_active", lambda: True)
    scheduled = []
    monkeypatch.setattr(S, "_schedule_store_repair", lambda t, tf: scheduled.append((t, tf)))
    S._DECLINED_SEEN.clear()
    with caplog.at_level(logging.WARNING, logger=S._log.name):
        out1 = S.sanitize_daily_bars("ZZBBD", _bars(closes), "D")
        out2 = S.sanitize_daily_bars("ZZBBD", _bars(closes), "D")
    assert [b["c"] for b in out1] == closes and [b["c"] for b in out2] == closes
    assert scheduled == []
    lines = [r.getMessage() for r in caplog.records if "split-heal declined" in r.getMessage()]
    assert len(lines) == 1, lines
    assert "ZZBBD" in lines[0] and DAYS[22] in lines[0] and DAYS[16] in lines[0] and "1.2000" in lines[0]
