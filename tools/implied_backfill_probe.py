"""Manual probe: for the next-14-day reporters, how many symbols can the
in-house expected-move service price RIGHT NOW? Run before launch to size
the cold-start (spec §6 row 2). Read-only; makes live Massive calls.

Usage:  python tools/implied_backfill_probe.py [--limit 50]
"""
import argparse
import sys

sys.path.insert(0, ".")

from api.services import implied_move, implied_store  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    args = ap.parse_args()
    reporters = implied_store.upcoming_reporters(days=14)[: args.limit]
    if not reporters:
        print("no upcoming reporters (check FINNHUB_API_KEY)")
        return 1
    ok, fail = [], []
    for rep in reporters:
        payload = implied_move.get_expected_move(rep["sym"], rep["report_date"])
        (ok if payload else fail).append(rep["sym"])
        print(f"{rep['sym']:<6} {rep['report_date']}  "
              f"{'±%.1f%%' % payload['pct'] if payload else 'FAIL'}")
    print(f"\ncoverage: {len(ok)}/{len(reporters)} "
          f"({100 * len(ok) / max(1, len(reporters)):.0f}%)  failures: {', '.join(fail) or '-'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
