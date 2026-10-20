"""run_all — write every Study bank segment and print counts per segment.

    python -m scripts.study.run_all

Each generator's `generate()` returns {segment_name: [items]}; every segment
is validated (voice, grounding, ids, schema) before it is written to
docs/study/bank/<segment>.json. A validation problem stops the run with the
offending ids, never writes a half-segment.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study import (gen_candles, gen_fixtures, gen_recall, gen_regime, gen_size,  # noqa: E402
                           gen_terms, gen_walkthroughs)
from scripts.study._common import write_segment  # noqa: E402

GENERATORS = (gen_recall, gen_size, gen_fixtures, gen_regime, gen_candles, gen_walkthroughs, gen_terms)


def run() -> dict[str, int]:
    counts: dict[str, int] = {}
    for mod in GENERATORS:
        for name, items in mod.generate().items():
            write_segment(name, items)
            counts[name] = len(items)
    return counts


def main() -> int:
    counts = run()
    width = max(len(k) for k in counts)
    for name, n in counts.items():
        print(f"{name:<{width}}  {n:>5}")
    print(f"{'total':<{width}}  {sum(counts.values()):>5}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
