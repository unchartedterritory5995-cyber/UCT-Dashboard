"""THE ONE TICKER SPELLING SEAM for breadth reconstruction.

⛔⛔ WHY THIS EXISTS. The provider spells a share class with a DOT — the minute flat files,
the grouped daily files and the reference map all say `BRK.B` — while the UCT collector's
watchlist spells it with a DASH (`BRK-B`). The corrected V2 pass rewrote the grouped side
to dashes (`k.replace(".", "-")`) and left the minute side and the reference map as dots,
so every dual-class member (BRK.B, BF.B, CWEN.A, HEI.A, MOG.A, AKO.A, EBR.B …) got NO
levels, NO corporate-action factor and NO close: counted in the intraday `universe_count`
only. NYSE `universe_count` closed at its session low on every session because of it.

⭐ THE CANONICAL FORM IS THE PROVIDER'S SPELLING, because three of the four sources already
use it and the prices come from the provider. Only the evidenced transformation is applied:

    '-' → '.'      collector class separator (BRK-B → BRK.B, SPGI-WI → SPGI.WI)

⚠️ NOTHING ELSE. No upper-casing — the provider uses lower-case suffixes for preferreds
(`BFSpD`), and upper-casing would collide with real tickers (`ABCp` → `ABCP`). No `/`
handling — no source in this pipeline was observed to use it. A spelling this function
does not map simply fails to match, which is fail-closed and shows up in the census.
"""
from __future__ import annotations


def canon(t: str) -> str:
    """Canonical (provider) spelling of a ticker."""
    t = (t or "").strip()
    return t.replace("-", ".") if "-" in t else t


def canon_map(d: dict) -> dict:
    """Re-key a {ticker: value} map to canonical spelling. ⛔ Refuses a collision rather
    than letting one spelling silently overwrite another's price."""
    out = {}
    for k, v in d.items():
        c = canon(k)
        if c in out and out[c] != v:
            raise ValueError(f"ticker spelling collision on {c!r}: {k!r}")
        out[c] = v
    return out
