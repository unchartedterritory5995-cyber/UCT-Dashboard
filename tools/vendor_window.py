"""⛔⛔ THE WINDOW CHECK EVERY VENDOR CAPTURE OWES — DERIVED, NEVER TYPED.

Owner ruling, 2026-09-12, out of the AGEN firing-count divergence:

    Every vendor capture records `bars_loaded` on the vendor side and asserts it
    against the script's largest declared window BEFORE the read. A capture
    where `bars_loaded` is below that window is marked WINDOW_TRUNCATED — not
    void — and its window-dependent columns are excluded from comparison.

⚰️ WHY IT IS A RULE. `uncharted-volume-v2` fired its HVE condition 23 times on
the vendor's 4,066-bar AGEN series and 8 times on our 6,684-bar one. Neither
side is wrong: `ta.highest(volD[1], 2500)` over a window that is not yet full
returns the max of what exists, so a shallower series carries a LOWER running
maximum and the condition clears more often. **A firing is a statement about
the loaded window, not about the symbol's life.** That capture had to be forced
to 4,066 bars — the study loaded 1,003 on add and 400 after a timeframe change,
both under the window — and a capture taken at either of those depths would
have recorded the shortfall as if it were the script's answer.

⭐ THE NUMBER IS READ OFF THE OTHER LANE, NOT WRITTEN HERE. `largest_window`
comes from `tools/lookback_agreement.json`, the R-G cross-lane oracle that
`lookbackAgreement.test.js` writes with the JS readers' own answers. A window
typed into this file would be a second authority over a value two readers
already agree on, and it would go stale the first time the script changed.

⚠️ IT READS 2,751, NOT THE 2,500 THE INPUT DECLARES. `maxLookback` is a tree
SUM: the 2,500 input is the largest single term in `HVE Trigger`'s reach and
not the whole of it. 2,751 is the conservative floor — a capture clearing it
clears the input's 2,500 as well — and it is what both readers measured, so it
is what this module uses.
"""

from __future__ import annotations

import io
import json
import pathlib
from typing import Dict, Iterable, List, Mapping, Optional, Tuple

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORACLE = ROOT / "tools" / "lookback_agreement.json"

FULL_WINDOW = "FULL_WINDOW"
WINDOW_TRUNCATED = "WINDOW_TRUNCATED"
UNMEASURED = "UNMEASURED"
VERDICTS = (FULL_WINDOW, WINDOW_TRUNCATED, UNMEASURED)


def load_oracle(path: Optional[pathlib.Path] = None) -> Mapping[str, object]:
    return json.load(io.open(path or ORACLE, encoding="utf-8"))


def declared_windows(script_rel: str, oracle: Optional[Mapping] = None) -> Dict[str, int]:
    """`{output title -> the window that output declares}` for one member script.

    ⛔ The oracle stores DISTINCT TREES, not every (script, lane, output) triple —
    a tree already walked under another entry is not repeated. So a title absent
    here is not a title with no window; it is a title this map cannot speak for,
    and the caller must fail loudly rather than read the absence as a zero. The
    rail does exactly that.
    """
    doc = oracle if oracle is not None else load_oracle()
    windows: Dict[str, int] = {}
    for row in doc["rows"]:
        if row.get("from") != script_rel:
            continue
        lint, interpret = int(row["lint"]), int(row["interpret"])
        if lint != interpret:
            # The oracle exists because the two readers agree. If they ever stop,
            # a capture rule built on either one is built on sand.
            raise ValueError(
                f"{script_rel}: the readers disagree on {row.get('title')!r} "
                f"(lint {lint}, interpret {interpret}); settle R-G before "
                "trusting any window derived from them.")
        title = row.get("title") or ""
        windows[title] = max(windows.get(title, 0), lint)
    if not windows:
        raise KeyError(
            f"{script_rel}: no rows in the cross-lane oracle. A capture whose "
            "script the readers have never walked has no derived window to be "
            "checked against.")
    return windows


def largest_window(script_rel: str, oracle: Optional[Mapping] = None) -> int:
    return max(declared_windows(script_rel, oracle).values())


def classify(bars_loaded: Optional[int], windows: Mapping[str, int]) -> Tuple[str, List[str]]:
    """`(verdict, columns excluded from comparison)`.

    A column is excluded when ITS OWN declared window exceeds what was loaded —
    per column, never all-or-nothing. At 1,003 bars `HVE Trigger` (2,751) is
    unanswerable while `Volume` (0) and the three 50-bar columns are as good as
    they would be at any depth, and throwing those away would discard a real
    measurement to punish an unrelated one.

    ⛔ `bars_loaded is None` is REFUSAL, not a pass. Depth that was never read
    cannot be assumed, so every column that needs any history at all is
    excluded — which is the cost of not measuring, and the reason to measure.
    """
    if bars_loaded is None:
        return UNMEASURED, sorted(t for t, w in windows.items() if w > 0)
    loaded = int(bars_loaded)
    short = sorted(t for t, w in windows.items() if w > loaded)
    return (WINDOW_TRUNCATED if short else FULL_WINDOW), short


def check(bars_loaded: Optional[int], script_rel: str,
          oracle: Optional[Mapping] = None) -> Dict[str, object]:
    """The whole block a capture should carry, computed rather than transcribed."""
    windows = declared_windows(script_rel, oracle)
    verdict, excluded = classify(bars_loaded, windows)
    return {
        "script": script_rel,
        "bars_loaded": bars_loaded,
        "largest_declared_window": max(windows.values()),
        "declared_windows": dict(sorted(windows.items())),
        "verdict": verdict,
        "excluded_from_comparison": excluded,
    }


def uncovered(titles: Iterable[str], windows: Mapping[str, int]) -> List[str]:
    """Captured plot titles the oracle cannot speak for. Any is a stop."""
    return sorted(t for t in titles if t not in windows)
