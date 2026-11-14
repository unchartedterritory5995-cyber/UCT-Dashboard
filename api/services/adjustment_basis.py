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

import hashlib
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

# ── THE adjustment basis id (`adj_basis`, docs/architecture/bar-contract.md §2) ──────
#
# ⭐ ONE OWNER. `adj_basis` names the set of split events whose adjustment the rows of an
# INTRADAY series are on: a split (date d, ratio r) is APPLIED when every row before the
# split's first post-split bar is divided by r (volume x r). The id is a pure function of
# that event set, so it is STORE-INDEPENDENT (bars-api, the web pod and the worker name one
# basis the same way; `history_rev` is comparable only within one store) and it changes
# exactly when the stored rows move onto another basis.
#
#   "s0"            no adjudicable split applied (incl. a ticker that never split)
#   "s1:<12 hex>"   sha1 over the sorted canonical events "YYYY-MM-DD:<ratio %.6g>"
#   None            unknown (never checked, or a cliff the heal could not prove)
#
# Only `bars_sanitize.adjudicable` events count: a 3% stock dividend is never healed (its
# accept band contains 1.0), so it must not move the id either.
# Writer: `intraday_split_heal` stamps `series_meta.adj_basis` (with the rescaled rows, in
# the heal's one transaction). Readers: `bar_contract.compute` serves it; the client
# BarStore stamps every persisted record with it and refuses a record on another basis.

_ET = ZoneInfo("America/New_York")
#: A declared split date can sit a few sessions AFTER the session the price stepped on
#: (`bars_sanitize._SPLIT_BOUNDARY_WINDOW`, the DD case): an event this close is already
#: part of the target basis, so the heal looks for its cliff as soon as one can show.
DECLARED_PAD_DAYS = 10
BASIS_NONE = "s0"


def _event_key(d, ratio) -> Optional[tuple]:
    try:
        iso = date.fromisoformat(str(d)[:10]).isoformat()
        r = float(ratio)
    except (TypeError, ValueError):
        return None
    if not (r > 0):
        return None
    return iso, r


def adjudicable_events(splits: Iterable, as_of: Optional[date] = None) -> list:
    """Declared splits that can move the basis, as sorted, unique `(iso_date, ratio)`:
    adjudicable (`bars_sanitize.adjudicable`) and dated on/before `as_of` (default: today
    ET) + DECLARED_PAD_DAYS."""
    from api.services.bars_sanitize import adjudicable
    if as_of is None:
        as_of = datetime.now(_ET).date()
    hi = (as_of + timedelta(days=DECLARED_PAD_DAYS)).isoformat()
    out = set()
    for s in splits or ():
        try:
            k = _event_key(s[0], s[1])
        except (TypeError, IndexError):
            k = None
        if k is None or k[0] > hi or not adjudicable(k[1]):
            continue
        out.add(k)
    return sorted(out)


def canonical(events: Iterable) -> str:
    """The canonical text of a set of applied split events: sorted, unique
    "YYYY-MM-DD:<ratio %.6g>" joined by ";" ("" = none). What `series_meta.adj_basis`
    STORES (so the heal can read back which events a series is known to be on); the
    served id is `basis_id` of it."""
    keys = sorted({(d, f"{r:.6g}") for d, r in
                   (k for k in (_event_key(e[0], e[1]) for e in events or ()) if k is not None)})
    return ";".join(f"{d}:{r}" for d, r in keys)


def parse_canonical(text) -> Optional[list]:
    """`canonical` back to [(iso, ratio)]; None for None (unknown) or unreadable text."""
    if text is None:
        return None
    out = []
    for part in str(text).split(";"):
        if not part:
            continue
        d, _, r = part.partition(":")
        k = _event_key(d, r)
        if k is None:
            return None
        out.append(k)
    return out


def basis_id(events: Iterable) -> str:
    """THE id of a set of APPLIED split events (`(date, ratio)` pairs). Order- and
    duplicate-insensitive; ratios canonicalised to 6 significant digits."""
    canon = canonical(events)
    if not canon:
        return BASIS_NONE
    return "s1:" + hashlib.sha1(canon.encode("ascii")).hexdigest()[:12]


def bind_stamp(events, history_rev: int, first_ts) -> str:
    """The text `series_meta.adj_basis` stores: the applied events BOUND to the series'
    `history_rev` and first stored row at stamp time ("v2|<hrev>|<first_ts>|<canonical>").
    A write that changes held history (moves history_rev) or prepends older rows (moves the
    first row) — e.g. an old-basis fallback or merge — voids the stamp (review of #1144 D3)."""
    return f"v2|{int(history_rev)}|{'' if first_ts is None else int(first_ts)}|{canonical(events)}"


def parse_stamp(text):
    """`bind_stamp` text → (history_rev, first_ts | None, [(iso, ratio)]) or None."""
    if not isinstance(text, str) or not text.startswith("v2|"):
        return None
    parts = text.split("|", 3)
    if len(parts) != 4:
        return None
    try:
        hrev = int(parts[1])
        first = int(parts[2]) if parts[2] else None
    except ValueError:
        return None
    ev = parse_canonical(parts[3])
    return None if ev is None else (hrev, first, ev)


def target_basis_id(splits: Iterable, as_of: Optional[date] = None) -> str:
    """The basis a series is on once every adjudicable declared split is applied — what a
    provider's `adjusted=true` answer is on today."""
    return basis_id(adjudicable_events(splits, as_of))


@dataclass(frozen=True)
class AdjustmentBasis:
    splits: bool | None       # None = we could not determine it
    dividends: bool | None    # ALWAYS None -- out of CP7's scope, see module docstring
    as_of: str | None         # ISO date of the newest action folded in
    applied_by: str | None    # 'vendor' | 'bars_sanitize' | 'bars_split_repair' | None
    # TERM-055 (additive): the first session at the post-split scale of a declared split
    # this series SHOWS AS A CLIFF (not applied, and nothing on the serve path heals it).
    # Set only alongside `splits=False`; None everywhere else, including "undetermined".
    unadjusted_split_at: str | None = None

    def to_dict(self) -> dict:
        return {"splits": self.splits, "dividends": self.dividends,
                "as_of": self.as_of, "applied_by": self.applied_by,
                "unadjusted_split_at": self.unadjusted_split_at}


UNDETERMINED = AdjustmentBasis(splits=None, dividends=None, as_of=None, applied_by=None)

#: Intraday timeframes the basis answers for (TERM-055). Same set the bars route serves.
INTRADAY_TFS = ("1", "5", "15", "30", "60")
#: Rows read for an intraday basis: enough sessions for the ± window around a recent
#: declared split on every intraday tf, still one local indexed read.
_INTRADAY_ROWS = 5000


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
    if tf in INTRADAY_TFS:
        return _intraday_basis(ticker, tf)
    if tf not in ("D", "W", "M"):
        return UNDETERMINED
    try:
        from api.services import bars_sanitize, bars_sqlite

        meta = bars_sanitize._meta_cached(ticker)
        if meta is None:
            return UNDETERMINED  # cold miss -- a warm was scheduled; we cannot say yet

        splits = meta.get("splits") or []
        if not splits:
            return AdjustmentBasis(splits=False, dividends=None, as_of=None,
                                    applied_by="vendor")

        newest_declared = max(s[0] for s in splits)

        # One sqlite step, not one per row: this is the chart header's split label, asked for
        # on every symbol a member reaches, and row by row it took seconds on the busy pod.
        rows = bars_sqlite.get_bars_fast(ticker, tf, 400)
        if not rows:
            return UNDETERMINED
        bars = [{"t": _ymd_to_iso(r[0]), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                for r in rows]
        unadjusted = bars_sanitize.unadjusted_splits(bars, splits)
        if not unadjusted:
            # every declared split IS already reflected in the stored rows
            return AdjustmentBasis(splits=True, dividends=None,
                                    as_of=newest_declared, applied_by="vendor")

        # a real gap exists between what's declared and what's stored.
        # ⛔ It is healed ONLY when the serve path is allowed to adjust -- the
        # same predicate `sanitize_daily_bars` asks. With the switch off the
        # member sees the unadjusted cliff, so the honest answer is "not
        # adjusted", never a label naming a heal that is not running.
        # ⚰️ This said "bars_sanitize heals it on every SERVE regardless of the
        # flag"; untrue since 2026-08-10, when the flag was moved in front of
        # the adjustment. Production ran with the flag off and the label said
        # "adjusted by UCT" over the cliff.
        if not bars_sanitize.split_adjust_active():
            return AdjustmentBasis(splits=False, dividends=None,
                                    as_of=newest_declared, applied_by=None,
                                    unadjusted_split_at=max(u[0] for u in unadjusted).isoformat())
        return AdjustmentBasis(splits=True, dividends=None,
                                as_of=newest_declared, applied_by="bars_split_repair")
    except Exception:
        return UNDETERMINED


def _intraday_basis(ticker: str, tf: str) -> AdjustmentBasis:
    """TERM-055 — the basis for an INTRADAY series.

    `bars_sanitize` is D/W/M only and the intraday payload is the vendor's `adjusted=true`
    feed served as-is (tests/test_intraday_split_is_not_staleness.py); a stored cliff is
    healed IN THE STORE by `intraday_split_heal` (which stamps `adj_basis`). So the
    stored series gives exactly three answers:

      * a declared split inside the stored series shows as a cliff
        (`bars_sanitize.intraday_unadjusted_splits`) ⇒ `splits=False`, `applied_by=None`,
        `unadjusted_split_at` = the first session at the new scale;
      * a declared split inside the series shows NO cliff ⇒ the vendor adjusted it;
      * no declared split inside the series ⇒ there is nothing to adjust in what is shown.

    Same reads as the daily path (cache-only meta, one local store read) — never a vendor
    fetch. Never raises."""
    try:
        from api.services import bars_sanitize, bars_sqlite

        meta = bars_sanitize._meta_cached(ticker)
        if meta is None:
            return UNDETERMINED
        splits = meta.get("splits") or []
        # (decided before the read: a ticker with no declared split needs no rows at all)
        if not splits:
            return AdjustmentBasis(splits=False, dividends=None, as_of=None, applied_by="vendor")
        rows = bars_sqlite.get_bars_fast(ticker, tf, _INTRADAY_ROWS)
        if not rows:
            return UNDETERMINED
        bars = [{"t": int(r[0]), "c": r[4]} for r in rows]
        sessions = bars_sanitize.session_closes(bars)
        if len(sessions) < 2:
            return UNDETERMINED
        first, last = sessions[0]["t"], sessions[-1]["t"]
        # a split is "in" the series when its first post-split session is one the series
        # reaches and at least one session precedes it
        inside = [s for s in splits if first < str(s[0])[:10] <= last]
        if not inside:
            return AdjustmentBasis(splits=False, dividends=None, as_of=None, applied_by="vendor")
        newest_inside = max(str(s[0])[:10] for s in inside)
        cliffs = bars_sanitize.intraday_unadjusted_splits(bars, inside)
        if cliffs:
            return AdjustmentBasis(splits=False, dividends=None, as_of=newest_inside,
                                    applied_by=None,
                                    unadjusted_split_at=max(c[0] for c in cliffs).isoformat())
        return AdjustmentBasis(splits=True, dividends=None, as_of=newest_inside,
                                applied_by="vendor")
    except Exception:
        return UNDETERMINED
