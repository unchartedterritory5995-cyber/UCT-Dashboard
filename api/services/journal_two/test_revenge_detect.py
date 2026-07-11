"""Pure revenge-trade detector (Journal A+ P5, Task A8).

A revenge flag = loss + same-symbol re-entry within a time window. Requires
REAL execution times on both the prior exit and the current entry — date-only
rows are skipped entirely (revenge is a minutes-apart signal, not a day signal).
"""
from __future__ import annotations


def _t(ref, symbol, entry, exit_, net, *, gross=None):
    """Minimal trade dict as the detector consumes them."""
    return {
        "tradeRef": ref,
        "symbol": symbol,
        "entry_date": entry,
        "exit_date": exit_,
        "pnlDollar": gross if gross is not None else net,
        "pnlDollarNet": net,
    }


def test_detects_same_symbol_reentry_after_loss_within_window():
    from api.services.journal_two.revenge_detect import detect
    rows = [
        _t("id:a", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z", -100),
        # re-entry 30 min after the prior exit → within the 60-min window
        _t("id:b", "NVDA", "2026-04-19T15:00:00Z", "2026-04-19T15:30:00Z", 50),
    ]
    out = detect(rows)
    assert len(out["flags"]) == 1
    f = out["flags"][0]
    assert f["symbol"] == "NVDA"
    assert f["prevTradeRef"] == "id:a"
    assert f["tradeRef"] == "id:b"
    assert f["minutesApart"] == 30.0
    assert f["pairKey"] == "id:a->id:b"
    assert out["timeComponentCoverage"] == {"timed": 2, "total": 2}


def test_date_only_reentry_after_loss_is_not_flagged():
    """A date-only re-entry (bare date / exact-UTC-midnight) has no execution
    time → skipped, never flagged; it also does not count as timed."""
    from api.services.journal_two.revenge_detect import detect
    rows = [
        # prior loss is real-timed
        _t("id:a", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z", -100),
        # the re-entry is date-only → cannot be a revenge trade
        _t("id:b", "NVDA", "2026-04-19", "2026-04-19", 50),
    ]
    out = detect(rows)
    assert out["flags"] == []
    # only the real-timed row is "timed"
    assert out["timeComponentCoverage"] == {"timed": 1, "total": 2}


def test_all_date_only_rows_zero_timed():
    from api.services.journal_two.revenge_detect import detect
    rows = [
        _t("id:a", "NVDA", "2026-04-19", "2026-04-19", -100),
        _t("id:b", "NVDA", "2026-04-19T00:00:00Z", "2026-04-19T00:00:00Z", 50),
    ]
    out = detect(rows)
    assert out["flags"] == []
    assert out["timeComponentCoverage"] == {"timed": 0, "total": 2}


def test_suppressed_pairs_are_excluded():
    from api.services.journal_two.revenge_detect import detect
    rows = [
        _t("id:a", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z", -100),
        _t("id:b", "NVDA", "2026-04-19T15:00:00Z", "2026-04-19T15:30:00Z", 50),
    ]
    out = detect(rows, suppressed_pairs={"id:a->id:b"})
    assert out["flags"] == []
    # coverage is unaffected by suppression
    assert out["timeComponentCoverage"] == {"timed": 2, "total": 2}


def test_no_flag_after_a_win():
    from api.services.journal_two.revenge_detect import detect
    rows = [
        # prior trade is a WIN → re-entry is not revenge
        _t("id:a", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z", 100),
        _t("id:b", "NVDA", "2026-04-19T15:00:00Z", "2026-04-19T15:30:00Z", 50),
    ]
    out = detect(rows)
    assert out["flags"] == []


def test_no_flag_different_symbol():
    from api.services.journal_two.revenge_detect import detect
    rows = [
        _t("id:a", "AMD", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z", -100),
        _t("id:b", "NVDA", "2026-04-19T15:00:00Z", "2026-04-19T15:30:00Z", 50),
    ]
    out = detect(rows)
    assert out["flags"] == []


def test_no_flag_outside_window():
    from api.services.journal_two.revenge_detect import detect
    rows = [
        _t("id:a", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z", -100),
        # 90 min after the prior exit → outside the 60-min window
        _t("id:b", "NVDA", "2026-04-19T16:00:00Z", "2026-04-19T16:30:00Z", 50),
    ]
    out = detect(rows, window_minutes=60)
    assert out["flags"] == []
    # a wider window DOES flag it
    assert len(detect(rows, window_minutes=120)["flags"]) == 1


def test_nearest_prior_loss_is_chosen():
    """Two prior same-symbol losses in the window → the NEAREST (smallest gap)
    is the prevTradeRef."""
    from api.services.journal_two.revenge_detect import detect
    rows = [
        _t("id:a", "NVDA", "2026-04-19T13:00:00Z", "2026-04-19T13:10:00Z", -100),  # 50m before
        _t("id:b", "NVDA", "2026-04-19T13:40:00Z", "2026-04-19T13:50:00Z", -80),   # 10m before
        _t("id:c", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:20:00Z", 20),    # the re-entry
    ]
    out = detect(rows)
    flags = {f["tradeRef"]: f for f in out["flags"]}
    assert flags["id:c"]["prevTradeRef"] == "id:b"
    assert flags["id:c"]["minutesApart"] == 10.0


# ── Shared tilt-day helper (Task A10 — reused by analytics + calendar) ─────────


def _tt(ref, symbol, entry, exit_, net, result, *, day=None):
    """Trade dict for the tilt helper (adds result + spine day to `_t`)."""
    d = _t(ref, symbol, entry, exit_, net)
    d["result"] = result
    d["trading_day_et"] = day
    return d


def test_tilt_flags_day_with_revenge():
    from api.services.journal_two.revenge_detect import tilt_days_for_rows
    rows = [
        _tt("id:a", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z",
            -100, "Loss", day="2026-04-19"),
        _tt("id:b", "NVDA", "2026-04-19T15:00:00Z", "2026-04-19T15:30:00Z",
            50, "Win", day="2026-04-19"),
    ]
    assert tilt_days_for_rows(rows) == {"2026-04-19": 1}


def test_tilt_flags_day_with_three_consecutive_losses():
    from api.services.journal_two.revenge_detect import tilt_days_for_rows
    rows = [
        _tt("id:a", "AMD",  "2026-04-20T14:00:00Z", "2026-04-20T14:10:00Z",
            -10, "Loss", day="2026-04-20"),
        _tt("id:b", "TSLA", "2026-04-20T15:00:00Z", "2026-04-20T15:10:00Z",
            -10, "Loss", day="2026-04-20"),
        _tt("id:c", "MSFT", "2026-04-20T16:00:00Z", "2026-04-20T16:10:00Z",
            -10, "Loss", day="2026-04-20"),
    ]
    # different symbols → no revenge; the 3-loss cluster earns the tilt
    assert tilt_days_for_rows(rows) == {"2026-04-20": 1}


def test_tilt_ignores_a_calm_day():
    from api.services.journal_two.revenge_detect import tilt_days_for_rows
    rows = [
        _tt("id:a", "NVDA", "2026-04-21T14:00:00Z", "2026-04-21T14:30:00Z",
            100, "Win", day="2026-04-21"),
        _tt("id:b", "AMD",  "2026-04-21T15:00:00Z", "2026-04-21T15:30:00Z",
            -20, "Loss", day="2026-04-21"),
    ]
    # a single loss, no cluster, no revenge → no tilt day at all
    assert tilt_days_for_rows(rows) == {}


def test_tilt_respects_precomputed_revenge_flags():
    """When flags are passed pre-computed (e.g. the user dismissed the pair), a
    day whose ONLY tilt source was that revenge pair is NOT flagged."""
    from api.services.journal_two.revenge_detect import tilt_days_for_rows
    rows = [
        _tt("id:a", "NVDA", "2026-04-19T14:00:00Z", "2026-04-19T14:30:00Z",
            -100, "Loss", day="2026-04-19"),
        _tt("id:b", "NVDA", "2026-04-19T15:00:00Z", "2026-04-19T15:30:00Z",
            50, "Win", day="2026-04-19"),
    ]
    # empty flags (dismissed) + no 3-loss cluster → no tilt
    assert tilt_days_for_rows(rows, revenge_flags=[]) == {}
