"""api/services/adjustment_basis.py — D5 CHECKPOINT 7.

`AdjustmentBasis`: the label PRD/spec §3 calls for — *"splits=True and
splits=None are different facts."* Turns several independently-correct local
adjustment mechanisms (a vendor's own `adjusted=true`, `bars_sanitize`'s
serve-time heal, `bars_split_repair`'s store-side heal, `breadth_dividends`'
own basis) into one answerable question for ONE series, without moving any
of them.

⛔⛔ `None` IS A REAL VALUE AND MUST NEVER BE DEFAULTED (spec §3.1, D2 CP2.4's
rule inherited word for word). A payload that guesses "vendor" or
"bars_sanitize" when it does not actually know is worse than one that says
"we could not determine it" — the whole reason this label exists is to stop
a member's "why did the chart jump" ticket from being answered with a
confident-sounding lie.

⛔ WHAT CP7 DOES NOT DO. Per the D5 gate's own approval-line checklist item 5
("For CP7 — the member-facing SENTENCE, or an explicit deferral of it to
S8/S10"): this checkpoint explicitly DEFERS the member-facing rendering. No
UI reads this yet, and none is built here — it ships dark, same discipline
as every other D5 checkpoint this session. Consumed today only by the new
`GET /api/bars/{ticker}/adjustment-basis` endpoint (see `api/routers/bars.py`),
which nothing in the frontend calls yet.

⛔ `dividends` IS ALWAYS `None`. The packet is explicit: *"NOTHING about the
breadth dividend basis is in any checkpoint... D5 makes that divergence
nameable; it does not get to resolve it."* A dividend basis genuinely exists
(`breadth_dividends.py` has one) but CP7 does not read it, compute it, or
guess at it — `None` is the honest answer.

⛔ NO NEW SERVE-PATH CALL. `compute_adjustment_basis` reads ONLY
`bars_sanitize`'s own cache (`_meta_cached`, cache-only, no network) and the
SQLite store's own already-persisted rows (`bars_sqlite.get_bars`, a local
read) — never a vendor fetch. Same "no unbounded external call on a serve
path" invariant CLAUDE.md names as the 524-outage cause.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AdjustmentBasis:
    splits: bool | None       # None = we could not determine it
    dividends: bool | None    # ALWAYS None -- out of CP7's scope, see module docstring
    as_of: str | None         # ISO date of the newest action folded in
    applied_by: str | None    # 'vendor' | 'bars_sanitize' | 'bars_split_repair' | None

    def to_dict(self) -> dict:
        return {"splits": self.splits, "dividends": self.dividends,
                "as_of": self.as_of, "applied_by": self.applied_by}


UNDETERMINED = AdjustmentBasis(splits=None, dividends=None, as_of=None, applied_by=None)


def _ymd_to_iso(ts) -> str:
    """`bars_sqlite`'s D/W/M `ts` is a bare YYYYMMDD int; `unadjusted_splits`
    (via `_pd`) needs an ISO `YYYY-MM-DD` string. Same conversion
    `bars_fetch._fmt_sqlite_bars` already applies on the serve path."""
    s = str(ts)
    return f"{s[:4]}-{s[4:6]}-{s[6:]}"


def compute_adjustment_basis(ticker: str, tf: str) -> AdjustmentBasis:
    """The label for ONE (ticker, tf) series, as it stands right now.

    Never raises: any failure returns `UNDETERMINED` — a wrong "we don't
    know" is honest; a wrong "vendor" or "bars_sanitize" is not."""
    if tf not in ("D", "W", "M"):
        return UNDETERMINED
    try:
        from api.services import bars_sanitize, bars_split_repair, bars_sqlite

        meta = bars_sanitize._meta_cached(ticker)
        if meta is None:
            return UNDETERMINED  # cold miss -- a warm was scheduled; we cannot say yet

        splits = meta.get("splits") or []
        if not splits:
            return AdjustmentBasis(splits=False, dividends=None, as_of=None,
                                    applied_by="vendor")

        newest_declared = max(s[0] for s in splits)

        rows = bars_sqlite.get_bars(ticker, tf, 400)
        if not rows:
            return UNDETERMINED
        bars = [{"t": _ymd_to_iso(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                for r in rows]
        unadjusted = bars_sanitize.unadjusted_splits(bars, splits)
        if not unadjusted:
            # every declared split IS already reflected in the stored rows
            return AdjustmentBasis(splits=True, dividends=None,
                                    as_of=newest_declared, applied_by="vendor")

        # a real gap exists between what's declared and what's stored:
        # bars_sanitize heals it on every SERVE regardless of the flag below;
        # bars_split_repair is the mechanism that would heal the STORE itself,
        # when enabled -- name whichever one is the CANONICAL fix right now.
        applied_by = "bars_split_repair" if bars_split_repair.enabled() else "bars_sanitize"
        return AdjustmentBasis(splits=True, dividends=None,
                                as_of=newest_declared, applied_by=applied_by)
    except Exception:
        return UNDETERMINED
