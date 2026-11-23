"""Compare two tools/agent_latency_probe.py outputs (free: reads two text files, calls nothing).

  python tools/agent_latency_probe_compare.py BASE.txt BRANCH.txt

The probe sends each category's body twice in a row: `plain` first (the FIRST call — cold unless an earlier category
already wrote a shared prefix) and `stream` second (the WARM call — the same request again, inside the 5-minute cache).
Per category and side this prints model ms and cache_read tokens for both calls, then the medians. Numbers only.
"""
from __future__ import annotations

import statistics
import sys


def parse(path: str) -> dict:
    rows = {}
    for line in open(path, encoding="utf-8"):
        f = line.strip().split("|")
        if len(f) != 10 or f[0] == "cat" or f[3] == "-":
            continue
        cat, mode, _ft, model_ms, _calls, in_tok, _out, cache_read, _cost, _disp = f
        rows[(cat, mode)] = {"ms": int(model_ms), "in": int(in_tok), "read": int(cache_read or 0)}
    return rows


def med(xs: list[int]) -> str:
    return str(int(statistics.median(xs))) if xs else "-"


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    sides = {"base": parse(sys.argv[1]), "branch": parse(sys.argv[2])}
    cats = sorted({c for s in sides.values() for c, _ in s})
    print("cat|side|first_ms|first_cache_read|warm_ms|warm_cache_read")
    for cat in cats:
        for name, rows in sides.items():
            a, b = rows.get((cat, "plain")), rows.get((cat, "stream"))
            print(f"{cat}|{name}|{a['ms'] if a else '-'}|{a['read'] if a else '-'}|{b['ms'] if b else '-'}|{b['read'] if b else '-'}")
    print("side|first_ms_p50|first_cache_read_p50|first_calls_reading_cache|warm_ms_p50|warm_cache_read_p50")
    for name, rows in sides.items():
        first = [v for (c, m), v in rows.items() if m == "plain"]
        warm = [v for (c, m), v in rows.items() if m == "stream"]
        print(f"{name}|{med([v['ms'] for v in first])}|{med([v['read'] for v in first])}|"
              f"{sum(1 for v in first if v['read'] > 0)}/{len(first)}|{med([v['ms'] for v in warm])}|{med([v['read'] for v in warm])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
