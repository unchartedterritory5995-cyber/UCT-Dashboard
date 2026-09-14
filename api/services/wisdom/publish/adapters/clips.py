"""Clip pipeline export — read-only (W1 Part 5; CONTRACTS §6.6).

Route: `GET /api/internal/wisdom/publish/adapters/clip-candidates?video_id=&since=`
(require_push_secret). The clip program owns its side: this only lets clip selection prefer
call-plus-resolution moments.

WHAT IT SENDS: segment boundaries (ordinal, kind, t_start_s, t_end_s, author id), and per
record its type, stance, hindsight flag, ticker, author id, guest flag, setup vocab id,
stated outcome, review status, timestamps, and an outcome summary (returns, stop/target hit,
unverifiable + reason).
WHAT IT NEVER SENDS: transcript or segment text, thesis/trigger/reason text, any level or
price column, `has_private`, attendee names. The clip program already holds the transcript
(`/api/desk/recap-source`), and nothing here is needed to cut a clip.
"""
from __future__ import annotations

from typing import Optional

#: The only record keys this export may emit; the private-field property test reads it.
RECORD_KEYS = ("record_id", "record_type", "stance", "hindsight", "ticker", "author_id", "is_guest",
               "setup_vocab_id", "stated_outcome", "status", "stated_at_et", "t_start_s", "t_end_s", "outcome")
SEGMENT_KEYS = ("segment_id", "ordinal", "kind", "t_start_s", "t_end_s", "author_id")


def clip_candidates(video_id: int, since: Optional[str] = None) -> dict:
    from api.services.wisdom.core import store, timeutil
    from api.services.wisdom.publish.adapters import common

    if since is not None and timeutil.parse_iso(since) is None:
        raise ValueError("since must be an ISO-8601 timestamp")
    body = {"ok": True, "video_id": int(video_id), "youtube_id": None, "source_id": None, "as_of": common.now_iso(),
            "coverage_ratio": None, "incomplete": None, "segments": [], "records": []}
    with store.read(for_request=True) as conn:
        src = conn.execute(
            "SELECT source_id, media_pointer, coverage_ratio, incomplete FROM wisdom_sources WHERE external_ref = ? "
            "AND NOT EXISTS (SELECT 1 FROM wisdom_sources newer WHERE newer.supersedes_source_id = wisdom_sources.source_id) "
            "ORDER BY version DESC LIMIT 1", (f"edu_videos:{int(video_id)}",)).fetchone()
        if src is None:
            return body
        body.update(youtube_id=src["media_pointer"], source_id=src["source_id"], coverage_ratio=src["coverage_ratio"],
                    incomplete=bool(src["incomplete"]))
        body["segments"] = [dict(r) for r in conn.execute(
            f"SELECT {', '.join(SEGMENT_KEYS)} FROM wisdom_segments WHERE source_id = ? ORDER BY ordinal",
            (src["source_id"],))]
        sql = ("SELECT r.record_id, r.record_type, r.stance, r.hindsight, r.ticker, r.author_id, r.is_guest, "
               "r.vocab_id, r.stated_outcome, r.status, r.stated_at_et, s.t_start_s, s.t_end_s "
               "FROM wisdom_records r JOIN wisdom_segments s ON s.segment_id = r.segment_id "
               "WHERE r.source_id = ? AND r.status IN ('provisional', 'confirmed')")
        params: list = [src["source_id"]]
        if since:
            sql += " AND r.created_at >= ?"
            params.append(since)
        records = [dict(r) for r in conn.execute(sql + " ORDER BY s.ordinal, r.record_id", params)]
        outcomes: dict = {}
        if records:
            ids = [r["record_id"] for r in records]
            for o in conn.execute(
                    f"SELECT record_id, ret_5, ret_10, ret_20, stop_hit, target_hit, reconciliation, "
                    f"unverifiable_reason, n_sessions_available FROM wisdom_outcomes "
                    f"WHERE record_id IN ({','.join('?' * len(ids))}) ORDER BY computed_at ASC", ids):
                outcomes[o["record_id"]] = dict(o)  # newest wins
    for r in records:
        o = outcomes.get(r["record_id"])
        body["records"].append({
            "record_id": r["record_id"], "record_type": r["record_type"], "stance": r["stance"],
            "hindsight": bool(r["hindsight"]), "ticker": r["ticker"], "author_id": r["author_id"],
            "is_guest": bool(r["is_guest"]), "setup_vocab_id": r["vocab_id"], "stated_outcome": r["stated_outcome"],
            "status": common.status_label(r["status"]), "stated_at_et": r["stated_at_et"],
            "t_start_s": r["t_start_s"], "t_end_s": r["t_end_s"],
            "outcome": None if o is None else {
                "ret_5": o["ret_5"], "ret_10": o["ret_10"], "ret_20": o["ret_20"], "stop_hit": o["stop_hit"],
                "target_hit": o["target_hit"], "unverifiable": o["reconciliation"] == "unverifiable",
                "unverifiable_reason": o["unverifiable_reason"], "n_sessions": o["n_sessions_available"]},
        })
    return body
