"""Coverage check for the earnings wire — provider truth vs what the feed shows.

Answers the owner's standing question directly: *"did every notable company
that reported today make the feed with its headline numbers?"* Built after
2026-08-11, when 38 already-reported in-universe names were structurally
invisible (the calendar roster only knew EW+Finviz's 59 of FMP's 104).

`assess` is pure — NO I/O — mirroring `detect.py`'s split so the denominator
rules are testable without the network. `build_coverage` owns the two provider
legs and the store/roster reads.

Denominator rules (the provider-coverage-monitor lessons):
- A reporter without PUBLISHED actuals has not reported. It is counted as
  `scheduled_not_reported`, never as missing — otherwise every pre-print
  morning reads as an outage.
- A double provider failure returns `measured: False` and no numbers at all.
  A check that cannot measure must say so; a fabricated zero (or a fabricated
  clean bill) is how the last three monitors lied.

Each miss is classified by WHERE it was lost, because the fix differs:
- `missing_not_on_roster` — the calendar day-list never knew the name (the
  8/11 defect class; `_supplement_today_roster` is the fix).
- `missing_on_roster` — the roster has it but the detector has not written it
  (detector lag / not ticking — read `/api/calendar/wire-status`).
- `numbers_pending_on_feed` — the row exists but still shows "numbers
  pending…" although the provider has actuals (upgrade-in-place lag).
"""
from __future__ import annotations

import logging

_logger = logging.getLogger(__name__)


def _has_actuals(row: dict) -> bool:
    return row.get("epsActual") is not None or row.get("revenueActual") is not None


def assess(*, provider: dict[str, dict], wire_rows: list[dict],
           roster_syms: set) -> dict:
    """Pure diff of provider truth against the feed. NO I/O.

    `provider` maps SYM -> a provider calendar row (FMP/Finnhub both carry
    `epsActual` / `revenueActual`, the only fields read here).
    """
    reported = {s: r for s, r in provider.items() if _has_actuals(r)}
    wire_by_sym = {r.get("sym"): r for r in wire_rows or []}

    missing = sorted(s for s in reported if s not in wire_by_sym)
    missing_on_roster = [s for s in missing if s in roster_syms]
    missing_not_on_roster = [s for s in missing if s not in roster_syms]

    # "Numbers pending" means the feed lacks a figure THE PROVIDER PUBLISHED —
    # field by field, never "eps is null". KOPN (2026-08-11, +22.6% on a
    # revenue beat) published revenue with NO EPS actual: the row carried the
    # revenue, an eps-null check called it pending forever, and a monitor
    # keyed on that would have alerted nightly about a name that was showing
    # everything there was to show.
    def _lags(sym: str) -> bool:
        prov, row = reported[sym], wire_by_sym[sym]
        return ((prov.get("epsActual") is not None and row.get("eps_act") is None)
                or (prov.get("revenueActual") is not None and row.get("rev_act") is None))

    pending = sorted(s for s in reported if s in wire_by_sym and _lags(s))
    with_numbers = sum(1 for s in reported
                       if s in wire_by_sym and not _lags(s))

    return {
        "reported":                 len(reported),
        "scheduled_not_reported":   len(provider) - len(reported),
        "on_feed_with_numbers":     with_numbers,
        "missing_from_feed":        missing,
        "missing_not_on_roster":    missing_not_on_roster,
        "missing_on_roster":        missing_on_roster,
        "numbers_pending_on_feed":  pending,
        "ok":                       not missing and not pending,
    }


def build_coverage(md: str) -> dict:
    """Provider truth for the session (both legs, in-universe) diffed against
    the wire store. Returns `measured: False` when NEITHER provider answered —
    never a fabricated reading. One Finnhub call + one FMP day-chunk per call;
    the router caches this."""
    from api.routers import calendar as cal

    cap = None
    try:
        cap = cal._load_cap_universe()
    except Exception as exc:
        _logger.warning("wire coverage: cap universe load failed: %s", exc)

    def _keep(sym: str) -> bool:
        return (sym in cap) if cap else cal._is_us_symbol(sym)

    fh_raw = None
    fmp_raw = None
    try:
        fh_raw = cal._fh_get_month(md, md)
    except Exception as exc:
        _logger.warning("wire coverage: Finnhub leg failed: %s", exc)
    try:
        fmp_raw = cal._fmp_range_week(md, md)
    except Exception as exc:
        _logger.warning("wire coverage: FMP leg failed: %s", exc)

    if fh_raw is None and fmp_raw is None:
        return {
            "market_date": md,
            "measured":    False,
            "providers":   {"finnhub": False, "fmp": False},
            "missing_from_feed": [],
            "numbers_pending_on_feed": [],
            "note": "both provider legs failed — coverage NOT measured "
                    "(not zero, not clean; try again)",
        }

    provider: dict[str, dict] = {}
    for row in (fh_raw or {}).get("earningsCalendar") or []:
        sym = (row.get("symbol") or "").strip().upper()
        if not sym or str(row.get("date") or "")[:10] != md or not _keep(sym):
            continue
        provider[sym] = row
    for row in fmp_raw or []:
        sym = (row.get("symbol") or "").strip().upper()
        if not sym or str(row.get("date") or "")[:10] != md or not _keep(sym):
            continue
        prior = provider.get(sym)
        # FMP fills symbols Finnhub missed, and upgrades a Finnhub row that
        # has no actuals when FMP's does — actuals are the fact under test.
        if prior is None or (not _has_actuals(prior) and _has_actuals(row)):
            provider[sym] = row

    from api.services.wire import store
    wire_rows = store.get_prints(md)

    roster: set = set()
    try:
        from api.services.wire import detector
        roster = {r.get("sym") for r in detector.todays_reporters(md)}
    except Exception as exc:
        _logger.warning("wire coverage: roster read failed: %s", exc)

    out = assess(provider=provider, wire_rows=wire_rows, roster_syms=roster)
    out.update({
        "market_date": md,
        "measured":    True,
        "providers":   {"finnhub": fh_raw is not None, "fmp": fmp_raw is not None},
    })
    return out
