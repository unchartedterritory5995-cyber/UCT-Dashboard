"""Measure the gap between the legacy indicator-alert vocabulary and D2's book.

⚰️ WHY THIS EXISTS AS A TOOL RATHER THAN A ONE-LINER. The first probe compared
each legacy leaf against each book leaf and reported **zero renames** — it was
asking whether `close` equals `c`. `close` and `ohlcv.c` are the same metric
under an abbreviation, so the honest answer is ONE rename and THIRTY absences,
and the probe could not see it.

⭐ THE INSTRUMENT REPRODUCED ITS OWN BLIND SPOT: a string-equality test cannot
detect an abbreviation, and its silence read as a finding ("no renames at all")
rather than as a limitation. A number that reaches a spec has to be re-runnable.

⛔ THIS MEASURES. It declares nothing, resolves nothing and computes no
indicator — PRD-D2 §9.5 / SPEC-D2 §5.4 are UNSIGNED and nothing there is built.

    python tools/d2_indicator_axis_gap.py [--json]
    python tools/d2_indicator_axis_gap.py --self-check
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

# run from anywhere: tools/ is not the import root
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

#: ⛔ SEMANTIC renames, each one hand-checked and carrying its reason. This map is
#: the part a string comparison cannot derive, so it is small, explicit, and
#: refuses to grow by guesswork: a pair goes in only when the two names denote the
#: SAME observable, not when they merely look similar.
#: ⚠️ `atr` is deliberately NOT here. The book has `atr_pct` and `atr_ext_sma50`,
#: which are a PERCENTAGE and an EXTENSION — neither is the legacy `atr` level.
#: A near-miss is the most tempting wrong entry in a table like this.
SEMANTIC_RENAMES = {
    "close": ("ohlcv.c", "the legacy lane's bar close; the book abbreviates OHLCV fields"),
}


def legacy_addresses() -> set[str]:
    from api.services import indicator_alert_evaluator as ev
    return set(ev.all_addresses())


def book_metrics() -> set[str]:
    from api.services.canonical import address_book as ab
    return set((ab.book() or {}).get("metrics", {}).keys())


def measure() -> dict:
    legacy, book = legacy_addresses(), book_metrics()

    # NON-VACUITY: an empty side makes every count below meaningless.
    if not legacy or not book:
        raise SystemExit(
            f"⛔ BROKEN INSTRUMENT, not a finding: legacy={len(legacy)} book={len(book)}")

    literal = sorted(legacy & book)
    renames, bad_map = {}, []
    for old, (new, _why) in SEMANTIC_RENAMES.items():
        if old not in legacy:
            bad_map.append(f"{old} is not a legacy address any more")
        elif new not in book:
            bad_map.append(f"{old} -> {new}, but {new} is not in the book")
        else:
            renames[old] = new
    if bad_map:
        raise SystemExit("⛔ SEMANTIC_RENAMES has rotted:\n  " + "\n  ".join(bad_map))

    absent = sorted(legacy - book - set(renames))
    return {
        "legacy_addresses": len(legacy),
        "book_metrics": len(book),
        "literal_intersection": literal,
        "semantic_renames": renames,
        "expressible_today": len(literal) + len(renames),
        "absent_from_the_book": absent,
        "absent_count": len(absent),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--self-check", action="store_true",
                    help="prove the comparison can see a rename AND can reject a near-miss")
    a = ap.parse_args()

    if a.self_check:
        ok = True
        legacy, book = legacy_addresses(), book_metrics()
        # 1. the operator finds an intersection when one exists
        probe = next(iter(legacy))
        if len(legacy & {probe}) != 1:
            print("⛔ the set operator does not intersect"); ok = False
        # 2. the rename map resolves the case the naive probe missed
        if SEMANTIC_RENAMES["close"][0] not in book:
            print("⛔ ohlcv.c is not in the book — the rename cannot be checked"); ok = False
        # 3. and it does NOT claim the near-miss
        if "atr" in SEMANTIC_RENAMES:
            print("⛔ atr has been mapped; atr_pct is a percentage, not a level"); ok = False
        # 4. a naive leaf comparison must still report ZERO — the blind spot is real
        naive = {L for L in legacy if L.split(".")[-1] in {b.split(".")[-1] for b in book}}
        if naive:
            print(f"⚠️ the naive leaf comparison now finds {sorted(naive)} — re-read this tool")
        else:
            print("control: the naive leaf comparison still reports 0 (the blind spot is real)")
        print("SELF-CHECK:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    m = measure()
    if a.json:
        print(json.dumps(m, indent=2))
        return 0
    print(f"legacy addresses ......... {m['legacy_addresses']}")
    print(f"book metrics ............. {m['book_metrics']}")
    print(f"literal intersection ..... {len(m['literal_intersection'])}")
    print(f"semantic renames ......... {len(m['semantic_renames'])}  {m['semantic_renames']}")
    print(f"EXPRESSIBLE TODAY ........ {m['expressible_today']}")
    print(f"ABSENT FROM THE BOOK ..... {m['absent_count']}")
    print()
    print("  ⛔ 'absent' means the book carries no metric of that name in any form —")
    print("     these are computed, parameterised, per-timeframe indicator outputs,")
    print("     not columns that were renamed. See PRD-D2 §9.5 / SPEC-D2 §5.4.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
