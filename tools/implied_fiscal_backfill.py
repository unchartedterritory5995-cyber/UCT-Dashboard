"""CLI wrapper for `api.services.implied_store.repair_null_fiscal_keys` — a
one-shot, idempotent repair for `implied_snapshots` rows written with a NULL
`fiscal_year`/`fiscal_quarter` before Task 4 (2026-08-05) widened the nightly
capture's own enrichment to close the gap going forward (2916eb4e made FMP —
which carries no quarter/year — the primary reporter-list source;
implied_store.py's old `:365-370` hardcoded the fiscal key to None on every
FMP-sourced row).

Safe to re-run: see `repair_null_fiscal_keys`'s docstring for the full
safety contract (every write is a NULL-guarded UPDATE) and for WHY this is
only recoverable while the affected reports are still unreported.

Run this on the box that owns the real `implied_moves.db` (Railway web pod,
via `railway ssh`, where DATA_DIR defaults to `/data`) — running it against
a fresh local dev DB is a harmless no-op (nothing to repair).

Usage:
    python tools/implied_fiscal_backfill.py [--dry-run] [--limit N]

--dry-run   compute + print what WOULD be written, touch nothing.
--limit N   cap how many distinct symbols spend the per-symbol FMP repair
            leg in this run (default 200). Re-run (optionally raising this)
            to continue past the cap -- already-resolved rows are skipped
            automatically on the next pass.
"""
import argparse
import sys

sys.path.insert(0, ".")

from api.services import implied_store  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                     help="compute and print without writing to the DB")
    ap.add_argument("--limit", type=int, default=200,
                     help="max distinct symbols to spend the per-symbol FMP repair leg on")
    args = ap.parse_args()

    result = implied_store.repair_null_fiscal_keys(limit=args.limit, dry_run=args.dry_run)

    print(f"null-fiscal rows found: {result['total_null']}")
    if result["total_null"] == 0:
        print("nothing to repair")
        return 0

    if args.dry_run:
        print(f"would resolve: {result['resolved']}/{result['total_null']} (dry run -- nothing written)")
    else:
        print(f"resolved + written: {result['written']}/{result['total_null']}")

    still_unresolved = result["total_null"] - result["resolved"]
    if still_unresolved > 0:
        print(f"{still_unresolved} row(s) still unresolved after this pass -- "
              f"either re-run with a higher --limit, or the fiscal identity genuinely "
              f"isn't available from Finnhub/FMP for those rows yet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
