"""Cross-session ticker mentions for a Desk video's chart markers + timeline
(spec 2026-08-11, Phase 2 design section A) — the single authority both
features are built on: StockChart's Desk-mentions marker category and
TickerPopup's "Desk" timeline tab.

One row PER MENTION (a video discussing SYM twice yields two rows).
anchor_date derives from edu_videos.created_at via
`ticker_returns.anchor_date_et` — the ONE authority for that conversion; this
module never re-derives it. Symbol matching is case-insensitive and
$-stripped, mirroring desk_session_insights' own ticker normalization
(`.strip().upper().lstrip("$")`) so a mention stored as "$nvda" (or any other
case) still matches a query for "NVDA".

Implementation copies `education_service.related_videos_by_ticker`'s
documented idiom: small library (~300 rows) → Python scan over the
ticker_moments JSON column via `education_service.videos_with_ticker_moments`,
no SQLite JSON queries. Unknown/uncovered sym → {"mentions": [], ...} at
HTTP 200 (never 404 — the client renders an empty-state, not an error).

Per-sym in-process TTL cache (600s), mirroring ticker_returns' `_cache` shape
including the injectable `now` param (tests drive the clock instead of
sleeping)."""
import json as _json
import time
from datetime import datetime, timezone

from api.services import education_service as edu
from api.services.ticker_returns import anchor_date_et

_TTL_SECS = 600.0
_CAP = 50
_cache: dict[str, tuple[float, dict]] = {}


def _norm(sym: str) -> str:
    return (sym or "").strip().upper().lstrip("$")


def _desk_video_mentions(sym: str, now: float | None = None) -> dict:
    """The Desk video rows for one symbol, behind the per-symbol TTL cache.

    Unchanged body of the pre-Wisdom `mentions_for_symbol`; see that function for
    the flag-gated provider that runs AFTER this cache."""
    now = time.time() if now is None else now
    key = _norm(sym)
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    out: list[dict] = []
    if key:
        for row in edu.videos_with_ticker_moments():
            created_at = row.get("created_at")
            if not created_at:
                continue  # spec: skip videos with no created_at
            try:
                moments = _json.loads(row["ticker_moments"]) if row.get("ticker_moments") else []
            except Exception:
                moments = []
            if not isinstance(moments, list):
                continue
            anchor = anchor_date_et(created_at)
            for m in moments:
                if not isinstance(m, dict):
                    continue
                if _norm(m.get("ticker")) != key:
                    continue
                out.append({
                    "video_id": row["id"],
                    "youtube_id": row["youtube_id"],
                    "title": row.get("title") or "",
                    "anchor_date": anchor,
                    "t": int(m.get("t") or 0),
                    "note": str(m.get("note") or ""),
                })

    # newest-first by anchor_date then t: two-pass STABLE sort so ties on
    # anchor_date preserve ascending-t order (Python's sort is stable).
    out.sort(key=lambda x: x["t"])
    out.sort(key=lambda x: x["anchor_date"], reverse=True)
    out = out[:_CAP]

    payload = {
        "mentions": out,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _cache[key] = (now + _TTL_SECS, payload)
    return payload


def mentions_for_symbol(sym: str, now: float | None = None) -> dict:
    """Desk video rows, plus the Wisdom Loop's team CALL/MENTION rows when its flag is on.

    ⛔ The Wisdom gate sits OUTSIDE the per-symbol cache, on purpose: a flag read
    inside it would keep serving (or withholding) Wisdom rows for up to 600 s after
    a flip. Flag off returns the cached payload object itself — byte-identical to
    the pre-Wisdom endpoint, no wisdom.db read. The provider never raises into this
    route (CONTRACTS §6.6)."""
    payload = _desk_video_mentions(sym, now)
    try:
        from api.services.wisdom.core import flags as _wisdom_flags

        if not _wisdom_flags.desk_markers_enabled():
            return payload
        from api.services.wisdom.publish.adapters import desk_markers as _wisdom_markers

        return _wisdom_markers.merge(payload, sym)
    except Exception:
        return payload
