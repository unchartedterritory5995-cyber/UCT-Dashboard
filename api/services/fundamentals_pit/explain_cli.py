"""Provenance diagnostic: WHY does the chart show this number?

    python -m api.services.fundamentals_pit.explain_cli --db <pit.db> --ticker TSLA \
        --metric net_income_ttm [--at 2025-06-01T20:00:00Z] [--version N]
    python -m api.services.fundamentals_pit.explain_cli --db <pit.db> --sample 500 [--seed 7]

With --ticker/--metric it re-derives the point IN FORCE at --at (default: the
latest) from raw facts and prints every fact used, with its accession, form,
acceptance time and public time, plus `matches_served`.

With --sample it re-derives N random served points across the store and reports
how many reproduce exactly -- the determinism check for a whole build.

Read-only: the store is opened `mode=ro`.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime, timezone

from . import derive as D, store as S


def _point_in_force(conn, cik: int, metric: str, version: int, at: int | None):
    q = ("SELECT t_eff FROM series_point WHERE cik=? AND metric=? AND derivation_version=?"
         + (" AND t_eff<=?" if at is not None else "") + " ORDER BY t_eff DESC LIMIT 1")
    args = (cik, metric, version) + ((at,) if at is not None else ())
    row = conn.execute(q, args).fetchone()
    return row[0] if row else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", required=True)
    ap.add_argument("--ticker")
    ap.add_argument("--metric")
    ap.add_argument("--at", help="ISO instant; default = the latest point")
    ap.add_argument("--version", type=int, default=D.DERIVATION_VERSION)
    ap.add_argument("--sources", default=",".join(D.PRODUCTION_SOURCES),
                    help="split-ledger sources (a scratch store may use fixture:*)")
    ap.add_argument("--sample", type=int)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--dump", help="comma-separated tickers: write their series rows, split rows and Beta "
                                   "summaries as JSON (golden comparison)")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    conn = S.connect(a.db, readonly=True)
    sources = tuple(s for s in a.sources.split(",") if s)

    if a.dump:
        from . import beta_store as B
        ciks = sorted({c for c in (S.cik_for_ticker(conn, t.strip().upper()) for t in a.dump.split(",")) if c})
        q = ",".join("?" * len(ciks))
        rows = conn.execute(f"SELECT cik, metric, t_eff, v, period_end, method FROM series_point "
                            f"WHERE derivation_version=? AND cik IN ({q})", (a.version, *ciks)).fetchall()
        tick = {c: [r[0] for r in conn.execute("SELECT ticker FROM ticker_map WHERE cik=?", (c,))] for c in ciks}
        splits = conn.execute(f"SELECT * FROM split_event").fetchall()
        beta = {}
        for c in ciks:
            d = B.read(conn, c)
            if d:
                beta[c] = {"symbol": d["symbol"], "through": d["through"], "n": len(d["points"]),
                           "last": d["points"][-1] if d["points"] else None}
        doc = {"ciks": ciks, "tickers": tick, "rows": rows, "splits": splits, "beta": beta,
               "build": {c: S.build_info(conn, c, a.version) for c in ciks}}
        body = json.dumps(doc, default=str)
        if a.out:
            open(a.out, "w").write(body)
            print(json.dumps({"written": a.out, "ciks": len(ciks), "rows": len(rows)}))
        else:
            print(body)
        return 0

    if a.sample:
        rows = conn.execute("SELECT cik, metric, t_eff FROM series_point WHERE derivation_version=?",
                            (a.version,)).fetchall()
        random.Random(a.seed).shuffle(rows)
        ok, bad = 0, []
        for cik, metric, t_eff in rows[:a.sample]:
            r = D.explain(conn, cik, metric, t_eff, a.version, sources)
            if r["matches_served"]:
                ok += 1
            else:
                bad.append({"cik": cik, "metric": metric, "t_eff": t_eff,
                            "served": r["served"], "rederived": r["rederived"]})
        print(json.dumps({"sampled": min(a.sample, len(rows)), "matches": ok, "mismatches": bad[:20]}, indent=1))
        return 0 if not bad else 1

    if not (a.ticker and a.metric):
        ap.error("--ticker and --metric (or --sample) are required")
    cik = S.cik_for_ticker(conn, a.ticker.upper())
    if cik is None:
        print(json.dumps({"error": f"unknown ticker {a.ticker}"}))
        return 2
    at = None
    if a.at:
        at = int(datetime.fromisoformat(a.at.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp())
    t_eff = _point_in_force(conn, cik, a.metric, a.version, at)
    if t_eff is None:
        print(json.dumps({"ticker": a.ticker, "metric": a.metric, "point": None,
                          "note": "no point in force at that instant"}))
        return 0
    print(json.dumps(D.explain(conn, cik, a.metric, t_eff, a.version, sources), indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
