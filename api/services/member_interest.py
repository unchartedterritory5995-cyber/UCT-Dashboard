"""S6 CP2' -- the member-interest resolver. SPEC-S6-PERSONALIZATION §3 + §5.

Subsumes `calendar_personalization.get_user_ticker_sets` rather than sitting
beside it: this module now owns the four per-source SQL reads AND the
WEIGHTED SET registry, and `calendar_personalization.get_user_ticker_sets`
becomes a thin delegate with its signature unchanged (so `/api/calendar/
my-sets` is untouched -- a body swap, not a new endpoint). CP4's new
`GET /api/member/interest` + shared per-member cache key is a SEPARATE,
owner-blocked checkpoint (paid-gating, Decision Card 4) -- not built here.

WEIGHTED SET (SPEC-S6 §2's own stated recommendation -- Decision Card 1,
DEFAULTABLE, applied 2026-09-18: "the spec already names its own fallback;
applying it is not an owner decision unless the owner wants to override the
spec's stated default"): `interest_for` returns each entity's weight and the
sources that produced it (`because[]`), not four unlabeled sets. The weight
registry below (`SOURCE_BUCKETS`) is the SINGLE authority for the numbers
`importance.js`'s `impEff` used to hardcode as an independent if-chain
(CP3 derives from it instead of mirroring it -- Decision Card 2, also
DEFAULTABLE).

⛔ `calendar_personalization.py`'s own original docstring states: "Each
source is wrapped in try/except so one failing source never blocks the
others. Never raises." That invariant is carried over verbatim here, and it
is easy to lose in a refactor: a resolver that raises when one source is
down turns a personalization nicety into an outage on whatever surface asks
first (SPEC-S6 §5's own stated risk). The rail for this proves a FAILING
source yields a PARTIAL answer, never an empty one for the whole member --
distinguishing "this source returned nothing" from "this source failed"
(C5-02 §2's named anti-pattern: "empty-because-unreadable indistinguishable
from empty-because-new").
"""
from __future__ import annotations

import logging
import os
import sqlite3

_logger = logging.getLogger(__name__)


def _auth_db_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "auth.db")


def _watchlist_syms(user_id: str) -> set:
    try:
        conn = sqlite3.connect(_auth_db_path())
        try:
            rows = conn.execute(
                """SELECT wi.sym FROM watchlist_items wi
                   JOIN watchlists w ON w.id = wi.watchlist_id
                   WHERE w.user_id = ?""", (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.warning("member_interest._watchlist_syms failed for user %s: %s", user_id, e)
        return set()


def _flagged_syms(user_id: str) -> set:
    # Flagged is a watchlist with is_flagged_list=1 -- already covered by the
    # join above, but exposed separately so the UI can slice "Flagged" alone.
    try:
        conn = sqlite3.connect(_auth_db_path())
        try:
            rows = conn.execute(
                """SELECT wi.sym FROM watchlist_items wi
                   JOIN watchlists w ON w.id = wi.watchlist_id
                   WHERE w.user_id = ? AND w.is_flagged_list = 1""", (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.warning("member_interest._flagged_syms failed for user %s: %s", user_id, e)
        return set()


def _position_syms(user_id: str) -> set:
    """The member's OPEN Journal 2.0 positions, as a set of upper-case symbols.

    Reads through `journal_two.positions.list_open_positions` -- the one
    service that already knows what "open" means on `j2_positions`
    (`closed_at IS NULL`) and what the symbol column is called (`symbol`).
    ⛔ This function used to carry its own SQL naming `sym` and
    `status = 'open'`, neither of which `j2_positions` has: the query raised
    on every call, the except below swallowed it at INFO, and every member's
    open positions silently vanished from My Stocks. Owner scoping is the
    same as before: `user_id = ?` on the member's own auth.db.
    """
    try:
        from api.services.journal_two.positions import list_open_positions
        conn = sqlite3.connect(_auth_db_path())
        conn.row_factory = sqlite3.Row
        try:
            positions = list_open_positions(user_id, conn)
        finally:
            conn.close()
        return {str(p["symbol"]).upper() for p in positions if p.get("symbol")}
    except Exception as e:
        # WARNING, not INFO, and named: an empty set from here must never be
        # indistinguishable from "this member holds nothing".
        _logger.warning("member_interest._position_syms failed for user %s: %s",
                        user_id, e)
        return set()


def _uct20_syms(user_id: str) -> set:
    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data() or {}
        lead = wire.get("leadership") or wire.get("uct20") or []
        out = set()
        for item in lead:
            sym = item.get("sym") or item.get("ticker") if isinstance(item, dict) else item
            if sym:
                out.add(str(sym).upper())
        return out
    except Exception as e:
        _logger.warning("member_interest._uct20_syms failed: %s", e)
        return set()


# ── THE WEIGHT REGISTRY -- the one place these numbers live ──────────────────
#
# ⛔ Values carried over EXACTLY from `importance.js`'s pre-CP3 `impEff`:
#   positions            -> +3.0
#   watchlist OR flagged -> +2.0 (ONE bucket -- a symbol in both counts once,
#                                 not twice; this is why bucketing exists
#                                 rather than a flat per-source weight map)
#   uct20                -> +1.0
# CP3 derives `impEff`'s boost from this registry (via `WEIGHT_BUCKETS_PAYLOAD`
# below, serialized onto `/api/calendar/my-sets`) instead of hardcoding its
# own copy -- the ranking must come out byte-identical, which is exactly what
# preserving these three numbers and this bucketing shape guarantees.
#
# (name, bucket, weight) -- `name` must be one of `SOURCES` below; `bucket`
# groups names that share ONE weight; a symbol touching N names in the SAME
# bucket is credited that bucket's weight exactly once.
SOURCE_BUCKETS: tuple[tuple[str, str, float], ...] = (
    ("positions", "positions", 3.0),
    ("watchlist", "list", 2.0),
    ("flagged", "list", 2.0),
    ("uct20", "uct20", 1.0),
)

#: The declared source vocabulary, in registry order. This is the new single
#: authority CP1's rail (`tests/test_s6_member_interest_source_vocabulary.py`)
#: derives its server-side baseline from, post-migration.
SOURCES: tuple[str, ...] = tuple(name for name, _bucket, _w in SOURCE_BUCKETS)

_BUCKET_WEIGHT: dict[str, float] = {}
_SOURCE_TO_BUCKET: dict[str, str] = {}
for _name, _bucket, _w in SOURCE_BUCKETS:
    _BUCKET_WEIGHT[_bucket] = _w
    _SOURCE_TO_BUCKET[_name] = _bucket


def weight_buckets_payload() -> list[dict]:
    """The registry, JSON-safe and grouped by bucket, for the wire.

    CP3 attaches this to `/api/calendar/my-sets` (via `to_payload`) so
    `importance.js`'s `impEff` can derive its boost instead of mirroring a
    hardcoded copy. Grouped (not one row per source) so the client sums
    bucket weights directly without re-deriving the grouping itself --
    re-deriving it client-side would just be a second copy of THIS logic.
    """
    grouped: dict[str, list[str]] = {}
    for name, bucket, _w in SOURCE_BUCKETS:
        grouped.setdefault(bucket, []).append(name)
    return [{"sources": sorted(grouped[b]), "weight": w}
            for b, w in sorted(_BUCKET_WEIGHT.items())]


def interest_for(user_id: str) -> dict:
    """The member's entities, each carrying its weight and why it is there.

    Returns:
        {
          "by_source": {source_name: set(SYM, ...), ...},   # one per SOURCES
          "all_mine": set(SYM, ...),                         # the union
          "entities": {SYM: {"weight": float, "because": [source, ...]}},
        }

    Never raises. A source that fails contributes nothing to `by_source`,
    `all_mine`, and every entity's `because[]` -- it is never allowed to
    blank the OTHER sources' answers, matching
    `calendar_personalization.py`'s original stated contract verbatim.
    """
    # Built HERE, inside the call, NOT as a module-level constant: a dict
    # built once at import time would capture the ORIGINAL function objects
    # permanently, and `mock.patch.object(module, "_watchlist_syms", ...)`
    # (the per-source-isolation idiom this module's own rail and
    # `tests/test_calendar_personalization.py` both use) rebinds the
    # MODULE's name, not an already-frozen dict entry -- every isolation
    # test would silently exercise the real DB regardless of what it
    # patched. Building it fresh here means each call re-resolves these
    # names from the module's CURRENT globals.
    source_fns = {
        "watchlist": _watchlist_syms,
        "flagged": _flagged_syms,
        "positions": _position_syms,
        "uct20": _uct20_syms,
    }
    by_source: dict[str, set] = {}
    for name in SOURCES:
        try:
            by_source[name] = source_fns[name](user_id)
        except Exception as e:
            _logger.warning("member_interest.interest_for source %s failed for user %s: %s", name, user_id, e)
            by_source[name] = set()

    all_mine: set = set()
    for s in by_source.values():
        all_mine |= s

    entities: dict[str, dict] = {}
    for sym in all_mine:
        because = [name for name in SOURCES if sym in by_source[name]]
        touched_buckets = {_SOURCE_TO_BUCKET[name] for name in because}
        weight = sum(_BUCKET_WEIGHT[b] for b in touched_buckets)
        entities[sym] = {"weight": weight, "because": because}

    return {"by_source": by_source, "all_mine": all_mine, "entities": entities}
