"""Phase 4D-4C — read-only cross-repo evidence bridges for uct-clips.

Two narrow, additive facts uct-clips cannot derive on its own:

1. `get_session_time(video_id)` — the authoritative wall-clock start for a
   published Desk session video. Phase 4D-4C.3: prefers the DURABLE
   `edu_videos.media_started_at` (captured by desk_session_insights at
   processing time — survives `desk_session_jobs` being pruned, which it
   reliably is: only ~20 rows persist there in practice), falling back to
   the job-table lookup (`desk_session_jobs.start_time`) only for videos
   processed before this durable capture existed. FAILS CLOSED: a video with
   no `meeting_uuid` and no durable value and no matching job row returns
   `confidence: "unknown"` rather than guessing — never substitutes `now()`
   the way `desk_daily_session._to_et` does for thumbnail cosmetics.

2. `get_trade_linkage(...)` — a read-only slice of one user's J2 trades/
   positions/option strategies, annotated with the SAME stable `trade_ref`
   identity `journal_two.trade_refs` already uses for attachments. This is
   evidence for a LINKAGE-CONFIDENCE classifier that lives in uct-clips
   (ticker+date is never sufficient for a deterministic link) — this module
   only surfaces the rows and their real timestamp precision, never scores them.

No secrets, no writes, no user PII beyond email→user_id resolution (email is
supplied by the caller, not returned)."""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from api.services import auth_service, desk_session_jobs, education_service
from api.services.auth_db import get_connection as j2_connection
from api.services.journal_two.trade_refs import trade_ref_for_row

_ET = ZoneInfo("America/New_York")


def _parse_zoom_iso(raw: str | None) -> datetime | None:
    """Parse a Zoom webhook `start_time` (ISO 8601, normally UTC `Z`-suffixed).
    Returns None — never a fabricated fallback — on missing/unparseable input."""
    if not raw:
        return None
    iso = raw.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# Phase 4D-4C.3: edu_videos.media_started_at_source values, in the ORDER this
# function prefers them. 'zoom_webhook' is the pre-4D-4C.3 job-table fallback
# path, kept last — a real value from any durable source always wins over it.
_DURABLE_SOURCE_PRIORITY = ("zoom_recording_file", "zoom_meeting_start", "recovered_job_metadata")


def get_session_time(video_id: int) -> dict:
    """Returns:
    {
      ok: bool,
      video_id, youtube_id, title,
      meeting_uuid: str | None,
      start_time_raw: str | None,       # exactly what the source reported
      start_time_utc: str | None,       # ISO 8601 UTC
      start_time_et: str | None,        # ISO 8601 America/New_York
      provenance: "zoom_recording_file" | "zoom_meeting_start" |
                  "recovered_job_metadata" | "zoom_webhook" | None,
      source_recording_file_id: str | None,  # BEST tier only
      confidence: "authoritative" | "unknown",
    }
    Phase 4D-4C.3: prefers the DURABLE `edu_videos.media_started_at` (captured
    by desk_session_insights at processing time, so it survives
    desk_session_jobs being pruned) over the job-table lookup. Consumers no
    longer need to care whether the job row still exists once the durable
    value has landed — the job-table path (`provenance: "zoom_webhook"`) is
    kept ONLY as a fallback for videos processed before this durable capture
    existed, or where a genuine gap left it unpopulated.
    `confidence: "unknown"` whenever the chain breaks everywhere — no partial
    guess is ever returned as if it were real."""
    video = education_service.get_video(int(video_id))
    if not video:
        return {"ok": False, "error": "video not found"}

    meeting_uuid = (video.get("meeting_uuid") or "").strip() or None
    out = {
        "ok": True,
        "video_id": video.get("id"),
        "youtube_id": video.get("youtube_id") or "",
        "title": video.get("title") or "",
        "meeting_uuid": meeting_uuid,
        "start_time_raw": None,
        "start_time_utc": None,
        "start_time_et": None,
        "provenance": None,
        "source_recording_file_id": None,
        "confidence": "unknown",
    }

    durable_raw = video.get("media_started_at")
    durable_source = video.get("media_started_at_source")
    if durable_raw and durable_source in _DURABLE_SOURCE_PRIORITY:
        dt = _parse_zoom_iso(durable_raw)
        if dt is not None:
            out["start_time_raw"] = durable_raw
            out["start_time_utc"] = dt.astimezone(timezone.utc).isoformat()
            out["start_time_et"] = dt.astimezone(_ET).isoformat()
            out["provenance"] = durable_source
            out["source_recording_file_id"] = video.get("source_recording_file_id")
            out["confidence"] = "authoritative"
            return out
        # Durable field is present but corrupt/unparseable — fall through to
        # the job-table path rather than reporting unknown when a real (if
        # stale) job row might still answer.

    if not meeting_uuid:
        return out

    job = desk_session_jobs.get_job(meeting_uuid)
    if not job:
        return out  # video published, but its queue row is gone (pruned/legacy)

    raw = job.get("start_time")
    dt = _parse_zoom_iso(raw)
    out["start_time_raw"] = raw
    if dt is None:
        return out  # a meeting_uuid + job row exist, but start_time didn't parse

    out["start_time_utc"] = dt.astimezone(timezone.utc).isoformat()
    out["start_time_et"] = dt.astimezone(_ET).isoformat()
    out["provenance"] = "zoom_webhook"
    out["confidence"] = "authoritative"
    return out


# ── Trade linkage evidence ───────────────────────────────────────────────────

_TRADE_TABLES = (
    # (table, kind, date_column-for-range-filter)
    ("j2_trades", "trade", "exit_date"),
    ("j2_positions", "position", "entry_date"),
    ("j2_option_strategies", "option_strategy", "entry_date"),
)


def _row_symbol(table: str, row) -> str:
    keys = row.keys()
    if "symbol" in keys:
        return row["symbol"]
    if "underlying" in keys:
        return row["underlying"]
    return ""


def get_trade_linkage(
    email: str,
    symbol: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    """Read-only rows for one user (resolved by email — never accepts a raw
    user_id from the caller) across j2_trades / j2_positions /
    j2_option_strategies, each annotated with its stable `trade_ref`.

    This does NOT decide a linkage confidence tier — that classification
    (EXPLICIT / DETERMINISTIC / HIGH_CONFIDENCE_CANDIDATE / AMBIGUOUS / NONE)
    is uct-clips' job, applied to these rows plus its own video-time evidence.
    Precision matters more than it looks: entry_date/exit_date here are
    DATE-ONLY strings — this endpoint deliberately does not synthesize a
    fake time-of-day, so a caller can see for itself that ticker+date alone
    can never be a deterministic match."""
    user = auth_service.get_user_by_email(email)
    if not user:
        return {"ok": False, "error": "user not found"}
    user_id = user["id"]

    rows_out: list[dict] = []
    conn = j2_connection()
    try:
        for table, kind, date_col in _TRADE_TABLES:
            sql = f"SELECT * FROM {table} WHERE user_id = ?"
            params: list = [user_id]
            if date_from:
                sql += f" AND {date_col} >= ?"
                params.append(date_from)
            if date_to:
                sql += f" AND {date_col} <= ?"
                params.append(date_to)
            for row in conn.execute(sql, params).fetchall():
                sym = _row_symbol(table, row)
                if symbol and sym.upper() != symbol.upper():
                    continue
                keys = row.keys()
                rows_out.append({
                    "kind": kind,
                    "trade_ref": trade_ref_for_row(row),
                    "symbol": sym,
                    "source": row["source"] if "source" in keys else None,
                    "external_id": row["external_id"] if "external_id" in keys else None,
                    "entry_date": row["entry_date"] if "entry_date" in keys else None,
                    "exit_date": row["exit_date"] if "exit_date" in keys else None,
                    "closed_at": row["closed_at"] if "closed_at" in keys else None,
                    "side": row["side"] if "side" in keys else None,
                    "direction": row["direction"] if "direction" in keys else None,
                })
    finally:
        conn.close()

    return {"ok": True, "trades": rows_out}
