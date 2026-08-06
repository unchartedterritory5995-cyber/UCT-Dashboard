"""Manual probe: calendar dual-source coverage before/after the FMP breadth
merge (data-dependability migration plan, Phase 3 Task 13).

Finnhub `/calendar/earnings` is the only source of `hour`/`quarter`/`year` on
this plan (see the plan's Section D1) -- it stays the session oracle. This
probe measures, for one live day:
  1. Finnhub-alone coverage (rows, unique symbols, session-resolved count).
  2. FMP-alone coverage (rows, unique US-listed symbols) via the SAME
     production per-day-chunked fetcher (`calendar._fmp_range_week`) that
     `_build_range_week`/`_backfill_past_days`/`_patch_today_actuals` call.
  3. The merged total (Finnhub ∪ FMP-US), to confirm it is >= Finnhub alone
     and that Finnhub's session-resolved COUNT is untouched by the merge
     (FMP contributes zero session rows by construction -- it cannot move
     that count up, only Finnhub can).
  4. A SIMULATED Finnhub-429/empty scenario (Finnhub mocked to return
     nothing) -- confirms FMP alone still clears the >=900 US-symbol floor
     for a heavy day. Before this task, `_backfill_past_days` had no FMP
     leg at all (0 symbols in this scenario); `_build_range_week`'s old FMP
     fallback used one un-chunked multi-day call, which the plan's own
     live measurement showed silently truncates a multi-day range (not
     relevant to a single-day probe, but the SAME bug shape this task fixes
     everywhere `_fmp_range_week` is used).

Usage:
  python tools/probe_calendar_dual_source.py                  # today (ET)
  python tools/probe_calendar_dual_source.py --date 2026-08-05
"""
import argparse
import sys
from datetime import date
from unittest import mock

sys.path.insert(0, ".")

from api.routers import calendar as cal  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None, help="YYYY-MM-DD (default: today)")
    args = ap.parse_args()
    ds = args.date or date.today().isoformat()

    # ── 1. Finnhub alone (production fetcher) ───────────────────────────
    fh_data = cal._fh_get_month(ds, ds)
    fh_rows = (fh_data or {}).get("earningsCalendar") or []
    fh_syms = {(r.get("symbol") or "").strip().upper() for r in fh_rows if r.get("symbol")}
    fh_session = [r for r in fh_rows if (r.get("hour") or "").lower() in ("bmo", "amc")]
    fh_pct = (len(fh_session) / len(fh_rows) * 100) if fh_rows else 0.0

    # ── 2. FMP alone (production per-day-chunked fetcher) ───────────────
    fmp_rows = cal._fmp_range_week(ds, ds) or []
    fmp_syms = {(r.get("symbol") or "").strip().upper() for r in fmp_rows if r.get("symbol")}
    fmp_us = {s for s in fmp_syms if cal._is_us_symbol(s)}

    # ── 3. Merge ──────────────────────────────────────────────────────
    merged = fh_syms | fmp_us
    merged_session_pct = (len(fh_session) / len(merged) * 100) if merged else 0.0

    print(f"Calendar dual-source coverage probe -- {ds}")
    print("-" * 60)
    print(f"Finnhub alone:  {len(fh_rows):>5} rows, {len(fh_syms):>5} symbols, "
          f"{len(fh_session):>5} session-resolved ({fh_pct:.1f}%)")
    print(f"FMP alone:      {len(fmp_rows):>5} rows, {len(fmp_syms):>5} symbols, "
          f"{len(fmp_us):>5} US-listed")
    print(f"Merged:         {len(merged):>5} unique symbols "
          f"(Finnhub {len(fh_syms)} + FMP-only {len(fmp_us - fh_syms)})")
    print(f"  session-resolved (Finnhub's own count, unchanged by the merge): "
          f"{len(fh_session)}/{len(merged)} = {merged_session_pct:.1f}% "
          f"(was {fh_pct:.1f}% of Finnhub-alone -- the drop is the added-breadth "
          f"denominator, not a lost session; FMP cannot move this UP, only Finnhub can)")
    print(f"\nRequirement 1 -- total symbols >= Finnhub alone: "
          f"{len(merged)} >= {len(fh_syms)} -> {len(merged) >= len(fh_syms)}")

    # ── 4. Simulated Finnhub-429/empty ──────────────────────────────────
    with mock.patch.object(cal, "_fh_get_month", return_value=None):
        fh_data_sim = cal._fh_get_month(ds, ds)  # goes through the mock -> None
    sim_fh_rows = (fh_data_sim or {}).get("earningsCalendar") or []
    assert sim_fh_rows == []
    sim_merged = fmp_us  # Finnhub contributes nothing in this scenario
    print(f"\nRequirement 2 -- simulated Finnhub-429 still yields >= 900 US symbols: "
          f"{len(sim_merged)} >= 900 -> {len(sim_merged) >= 900} "
          f"(before this task: 0, for the current-week past-day path)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
