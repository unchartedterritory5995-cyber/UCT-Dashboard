"""``python -m api.services.rs_evidence`` - the CLI the worker spawns as a
SUBPROCESS (map §2.1: the `breadth_combined_pass` recipe - its own
interpreter and GIL, armed by a boot hook so a redeploy resumes it).

    --db PATH          the evidence store (REQUIRED; no default)
    --universe FILE    tickers, one per line (``#`` comments) or a JSON list;
                       default: the cap universe
    --sessions N       measure the newest N benchmark sessions (0 = every held one)
    --asof YYYY-MM-DD  measure as of this session; default: the newest held
    --benchmark SYM    default SPY
    --dry-run          measure, print the summary, write and publish NOTHING
    --split-fetch-budget N
                       provider fetches for the split guard's declared split
                       lists (default: `declared_splits.DEFAULT_FETCH_BUDGET`
                       on a real run, 0 on a dry run)
    --publish          publish the artifact; REQUIRES --dest
    --dest KEY         the R2 key, e.g. rs/evidence.json

EXIT CODES
    0  the run finished (measured; published when asked)
    1  the run failed, or --publish was asked and refused (row floor) or failed
    2  usage: a missing or contradictory argument, an unreadable universe file

The receipt is printed as ONE line ``receipt {json}`` and logged. Nothing in
this package reads an environment variable or a credential: the store path and
destination key are arguments, and the R2 client lives in `data_sync`.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from typing import Callable, List, Optional, Sequence

from .job import AUTO_SPLIT_BUDGET, DEFAULT_BENCHMARK, UsageError, run

log = logging.getLogger("api.services.rs_evidence")

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_USAGE = 2


def read_universe_file(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    stripped = text.strip()
    if stripped.startswith("["):
        data = json.loads(stripped)
        if not isinstance(data, list):
            raise UsageError(f"{path}: a JSON universe must be a list")
        return [str(t).strip().upper() for t in data if str(t).strip()]
    out = []
    for line in text.splitlines():
        s = line.split("#", 1)[0].strip()
        if s:
            out.append(s.upper())
    return out


def _parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="rs_evidence",
                                 description="UCT RS evidence job: forward excess returns of the RS signals, "
                                             "point-in-time over the held daily bars.")
    ap.add_argument("--db", required=True, help="path of the evidence store (REQUIRED; no default)")
    ap.add_argument("--universe", help="file of tickers (one per line or a JSON list); default the cap universe")
    ap.add_argument("--sessions", type=int, default=0, help="newest N benchmark sessions to measure (0 = all)")
    ap.add_argument("--asof", help="YYYY-MM-DD; default the newest held benchmark session")
    ap.add_argument("--benchmark", default=DEFAULT_BENCHMARK)
    ap.add_argument("--dry-run", action="store_true", help="measure and print; write and publish nothing")
    ap.add_argument("--publish", action="store_true", help="publish the artifact (requires --dest)")
    ap.add_argument("--dest", help="R2 key for the artifact, e.g. rs/evidence.json")
    ap.add_argument("--split-fetch-budget", type=int, default=None, metavar="N",
                    help="provider fetches for the split guard's declared split lists "
                         "(default: the nightly budget on a real run, 0 on a dry run)")
    return ap


def _print_summary(receipt: dict) -> None:
    art = receipt.get("artifact") or {}
    print(f"rs_evidence asof={receipt.get('asof')} benchmark={receipt.get('benchmark')} "
          f"sessions={art.get('sessions')} open={art.get('sessions_open')} universe={art.get('universe')} "
          f"rows={art.get('rows')} delisted={art.get('delisted_count')} publishable={art.get('publishable')}",
          flush=True)
    for name, sig in (art.get("per_signal") or {}).items():
        parts = []
        for h, x in sig["horizons"].items():
            hr = "-" if x["hit_rate"] is None else f"{x['hit_rate']:.3f}"
            md = "-" if x["median_excess"] is None else f"{x['median_excess']:+.2f}%"
            parts.append(f"h{h}: n={x['n']} hit={hr} med={md}")
        print(f"  {name:<28} events={sig['n_signals']} dates={sig['dates']}  " + " | ".join(parts), flush=True)
    base = art.get("baseline") or {}
    if base:
        parts = []
        for h, x in base.items():
            hr = "-" if x["hit_rate"] is None else f"{x['hit_rate']:.3f}"
            md = "-" if x["median_excess"] is None else f"{x['median_excess']:+.2f}%"
            parts.append(f"h{h}: n={x['n']} hit={hr} med={md}")
        print(f"  {'all_bars (baseline)':<28} " + " | ".join(parts), flush=True)
    print(f"  split guard: rows_skipped={receipt.get('split_skipped')} tickers_with_split="
          f"{receipt.get('split_tickers')} lists_unknown={receipt.get('split_unchecked')}", flush=True)


def main(argv: Optional[Sequence[str]] = None, *, bars_reader: Optional[Callable] = None,
         universe: Optional[Sequence[str]] = None, put_bytes: Optional[Callable] = None,
         delisted_fn: Optional[Callable] = None, splits_reader: Optional[Callable] = None) -> int:
    """Parse, run, print the receipt line, return the exit code. The keyword
    seams exist for tests (a synthetic reader, a spy for ``put_bytes``, a split
    list stub) and are not CLI arguments."""
    try:
        args = _parser().parse_args(list(argv) if argv is not None else None)
    except SystemExit as e:                                  # argparse: 2 on error, 0 on --help
        code = e.code
        return int(code) if isinstance(code, int) else EXIT_USAGE
    if args.publish and not args.dest:
        print("rs_evidence: --publish requires --dest (for example --dest rs/evidence.json)", file=sys.stderr)
        return EXIT_USAGE
    if args.publish and args.dry_run:
        print("rs_evidence: --publish and --dry-run contradict each other", file=sys.stderr)
        return EXIT_USAGE
    if args.sessions < 0:
        print("rs_evidence: --sessions must be 0 or a positive count", file=sys.stderr)
        return EXIT_USAGE
    if args.split_fetch_budget is not None and args.split_fetch_budget < 0:
        print("rs_evidence: --split-fetch-budget must be 0 or more", file=sys.stderr)
        return EXIT_USAGE
    budget = AUTO_SPLIT_BUDGET if args.split_fetch_budget is None else args.split_fetch_budget
    uni = universe
    if args.universe:
        try:
            uni = read_universe_file(args.universe)
        except (OSError, ValueError, UsageError) as e:
            print(f"rs_evidence: cannot read universe file: {e}", file=sys.stderr)
            return EXIT_USAGE
    try:
        receipt = run(db=args.db, dry_run=args.dry_run, publish_to=args.dest if args.publish else None,
                      sessions=args.sessions, asof=args.asof, benchmark=args.benchmark, universe=uni,
                      bars_reader=bars_reader, put_bytes=put_bytes, delisted_fn=delisted_fn,
                      splits_reader=splits_reader, split_fetch_budget=budget)
    except UsageError as e:
        print(f"rs_evidence: {e}", file=sys.stderr)
        return EXIT_USAGE
    except Exception as e:                                   # noqa: BLE001 - the exit code is the report
        log.exception("[rs_evidence] run failed: %s", e)
        print("receipt " + json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, sort_keys=True),
              flush=True)
        return EXIT_FAILED
    _print_summary(receipt)
    line = json.dumps(receipt, sort_keys=True, default=str)
    log.info("[rs_evidence] receipt %s", line)
    print("receipt " + line, flush=True)
    return EXIT_OK if receipt.get("ok") else EXIT_FAILED


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(message)s")
    sys.exit(main())
