"""Compare a stored price history against an independent vendor, AFTER the fact.

🔴 THIS IS THE CHECK WHOSE ABSENCE CORRUPTED PRODUCTION. The split repair verified a
candidate *before* it applied a factor and never looked again. Thirty-one tickers were
rescaled to values no vendor agrees with — `BF-A` by **3.3475×** — and every gate stayed
green, because nothing ever asked *"is it right NOW?"*

⭐ THE ASYMMETRY IS THE WHOLE POINT. A before-check asks *"does this look like a
split?"* — a question about a hypothesis. An after-check asks *"does the series match a
source that never saw our repair?"* — a question about the artifact. Only the second one
can catch a repair that was confidently wrong.

⛔ AND IT IS READ-ONLY BY CONSTRUCTION. Nothing in this module writes. That is not
timidity: a verifier that can also mutate is a verifier whose green result might be
describing its own edit, and this incident is what that looks like.

## What "matches" means, and why it is a MEDIAN

`ratio = ours / vendor`, per bar, then the **median** across the window.

⚠️ NOT the mean, and not a single bar. A mean is dragged by one bad print; a single bar
cannot tell a scale error from a stale quote. A rescale is a *multiplicative* error
applied to a whole span, so the median ratio over that span is exactly the shape it
makes — `1.0300` for one false stock-dividend pass, `0.86261` for five stacked ones.

⚠️ AND THE WINDOW MATTERS AS MUCH AS THE STATISTIC. Production's damage is confined to
pre-2020 history: every one of the 31 measures `1.00000` on the 2020+ window that
alerts, the screener, breadth and RS actually read. A verifier that only sampled recent
bars would have reported all 31 as clean — truthfully, and uselessly. `SPANS` below
exists so a caller cannot accidentally ask only the easy question.
"""
from __future__ import annotations

import logging
import statistics
from typing import Any, Iterable, Mapping, Optional

log = logging.getLogger(__name__)

#: A ratio this far from 1.0 is a scale error, not quote noise.
#:
#: ⚠️ DERIVED FROM THE SMALLEST THING WE MUST CATCH, not chosen for comfort. The
#: smallest false application observed was a 3% stock dividend (`1.0300`), so the
#: threshold sits well under it while staying clear of ordinary vendor disagreement
#: (dividend-adjustment differences and cent rounding live below ~0.5%).
DIVERGENCE_TOL = 0.005

#: ⭐ THE SPANS A VERDICT MUST COVER, and the second one is why this module exists.
#: `recent` is what every operational lane reads; `history` is where the damage is.
#: A caller that checked only `recent` would have called all 31 damaged tickers clean.
SPANS = ("history", "recent")

#: The boundary between them, as a bar key (YYYYMMDD). 2020-01-01 is where production's
#: measured damage stops — recorded so the number has a reason rather than a vibe.
RECENT_FROM_KEY = 20200101


def _median_ratio(ours: Mapping[int, float], vendor: Mapping[int, float],
                  lo: Optional[int] = None, hi: Optional[int] = None) -> tuple[Optional[float], int]:
    """The median of `ours/vendor` over the shared keys in `[lo, hi)`, and the count.

    ⛔ SHARED KEYS ONLY. A bar we hold and the vendor does not is a coverage question,
    not a scale question, and folding one into the other is how a verifier reports a
    divergence that is really a missing session.
    """
    ratios = []
    for key, mine in ours.items():
        if lo is not None and key < lo:
            continue
        if hi is not None and key >= hi:
            continue
        theirs = vendor.get(key)
        # ⛔ A ZERO OR MISSING VENDOR PRICE IS SKIPPED, NEVER TREATED AS A RATIO. It
        # would divide to infinity and drag a median into nonsense.
        if theirs is None or not theirs or mine is None or not mine:
            continue
        ratios.append(mine / theirs)
    if not ratios:
        return None, 0
    return statistics.median(ratios), len(ratios)


def compare(ours: Mapping[int, float], vendor: Mapping[int, float],
            tol: float = DIVERGENCE_TOL) -> dict:
    """Judge one ticker's stored history against a vendor's.

    Returns a verdict per span plus an overall `ok`. ⭐ `ok` IS THE CONJUNCTION: a
    ticker is clean only if EVERY span it has evidence for is clean, so a pristine
    recent window cannot vouch for a corrupted historical one. That is precisely the
    mistake that let this sit unnoticed.
    """
    out: dict[str, Any] = {"spans": {}, "ok": True, "judged": False}
    bounds = {
        "history": (None, RECENT_FROM_KEY),
        "recent": (RECENT_FROM_KEY, None),
    }
    for span in SPANS:
        lo, hi = bounds[span]
        ratio, n = _median_ratio(ours, vendor, lo, hi)
        if ratio is None:
            # ⛔ NO EVIDENCE IS NOT A PASS. It is recorded as `null` and excluded from
            # the conjunction, so "we could not tell" never reads as "it is fine".
            out["spans"][span] = {"ratio": None, "bars": 0, "ok": None}
            continue
        clean = abs(ratio - 1.0) <= tol
        out["spans"][span] = {"ratio": round(ratio, 5), "bars": n, "ok": clean}
        out["judged"] = True
        if not clean:
            out["ok"] = False
    if not out["judged"]:
        # Nothing could be judged at all — refuse to claim anything.
        out["ok"] = None
    return out


def verdict_line(ticker: str, result: Mapping[str, Any]) -> str:
    """One human-readable line. ⛔ NAMES THE SPANS AND THEIR RATIOS, never just a
    boolean — the whole incident is a story about a green flag with no number behind
    it, and `BF-A ok=False` would repeat that."""
    parts = []
    for span in SPANS:
        s = result.get("spans", {}).get(span) or {}
        r = s.get("ratio")
        parts.append(f"{span}={'n/a' if r is None else f'{r:.5f}'}({s.get('bars', 0)})")
    state = {True: "CLEAN", False: "DIVERGED", None: "NO-EVIDENCE"}[result.get("ok")]
    return f"{ticker:<8} {state:<11} " + " ".join(parts)


def summarise(results: Mapping[str, Mapping[str, Any]]) -> dict:
    """Counts, plus the DIVERGED tickers BY NAME.

    ⛔ THE NAMES ARE IN THE PAYLOAD, NOT ONLY THE COUNT. Tonight a summary line reported
    *"16 could not be"* and took the names to the grave because an emoji broke the
    print. A count without names is an alert nobody can act on.
    """
    diverged = sorted(t for t, r in results.items() if r.get("ok") is False)
    unknown = sorted(t for t, r in results.items() if r.get("ok") is None)
    return {
        "checked": len(results),
        "clean": sum(1 for r in results.values() if r.get("ok") is True),
        "diverged": len(diverged),
        "no_evidence": len(unknown),
        "diverged_tickers": diverged,
        "no_evidence_tickers": unknown,
    }


def rows_to_closes(rows: Iterable) -> dict[int, float]:
    """`bars_sqlite.get_bars` tuples → `{bar_key: close}`.

    ⚠️ TOLERANT OF BOTH SHAPES ON PURPOSE. The store hands back tuples and the fetchers
    hand back dicts; a verifier that only understood one would quietly compare an empty
    map against a full one and call it `NO-EVIDENCE` rather than failing loudly.
    """
    out: dict[int, float] = {}
    for row in rows or ():
        try:
            if isinstance(row, Mapping):
                key, close = row.get("t") or row.get("ts") or row.get("key"), row.get("c")
            else:
                key, close = row[0], row[4] if len(row) > 4 else row[-1]
            if key is None or close is None:
                continue
            out[int(key)] = float(close)
        except (TypeError, ValueError, IndexError, KeyError):
            continue
    return out
