"""Shared helpers for the dark publish adapters (stream S-F, docs/wisdom/CONTRACTS.md §6.6).

THE RULES EVERY ADAPTER IN THIS PACKAGE KEEPS
1. Flag OFF changes nothing in the consumer. A consumer-side hook returns its
   input untouched and never opens wisdom.db. The previews an owner reads come
   from the daily step (`adapters.run_daily`), which writes
   `wisdom_publish_log(action='would_publish')` rows and nothing a member sees.
   ⛔ A request-path hook never writes: a write per member request is the
   2026-07-01 single-process outage class.
2. Nothing here raises into a host. Consumer hooks catch everything.
3. Only the team authors in docs/wisdom/authors.json are "UCT said". Guests
   (D14) and attendees never are.
4. Provisional records say "provisional" wherever they surface (W1 §0.3).
5. Record reads name their columns from PUBLIC_RECORD_COLUMNS, an allowlist, so
   a column added to wisdom_records later cannot leave through an adapter by
   default. The level/price columns are read only by the two functions that
   need them (closed-record Model Book drafts, the D20 silent scorer).

CITATION ADDRESS — interim S8 locator (W1 Part 5):
    wisdom:<source_id>#<segment_id>@<t_or_section>
`t_or_section` is `<int seconds>s` for timed media, else the section path, else
`ord<ordinal>`. MIGRATION NOTE (D2): when the canonical uctUri model lands,
`locator()` is the single place that changes; every adapter builds addresses
through it and stores them verbatim, so a one-shot rewrite of the stored
`citations_json` / KB `content` "Source:" lines maps old to new by parsing this
exact grammar. Nothing may hand-build the string elsewhere.
"""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from typing import Iterable, Optional, Sequence

from api.services.wisdom.core import authors as _authors
from api.services.wisdom.core import ids, timeutil

GENERATOR_VERSION = "publish-adapters-w1.0"
ELIGIBLE_STATUSES = ("provisional", "confirmed")
VIDEO_STREAMS = frozenset({"zoom_live", "workshop", "interview", "education"})
STREAM_LABELS = {
    "zoom_live": "Live session", "workshop": "Workshop", "interview": "Interview",
    "education": "Education video", "discord": "Discord", "x": "X",
    "sunday_scans": "Sunday Scans", "sunday_scans_chart": "Sunday Scans chart",
    "zoom_frame": "Session frame", "model_book": "Model Book", "owner_feedback": "Owner note",
}

#: Columns an adapter may read from wisdom_records into anything it returns.
PUBLIC_RECORD_COLUMNS = (
    "record_id", "record_type", "segment_id", "source_id", "source_version", "author_id",
    "is_guest", "stated_at_et", "stated_at_precision", "ticker", "direction", "stance",
    "setup_name_raw", "vocab_id", "timeframe", "trigger_text", "thesis", "reason",
    "reason_class", "stated_outcome", "hindsight", "principle_key", "extraction_confidence",
    "status", "created_at",
)

#: Columns that can carry levels or an owner's position data. Never in an
#: adapter's output; the private-field property test asserts their absence.
PRIVATE_RECORD_COLUMNS = frozenset({
    "entry", "entry_zone_lo", "entry_zone_hi", "stop", "stop_text",
    "targets_json", "levels_json", "has_private",
})

#: Stances that describe a position the author has closed or is teaching after the fact.
CLOSED_STANCES = frozenset({"exited", "stopped_out", "hindsight"})
CLOSED_OUTCOMES = frozenset({"profit", "loss", "breakeven", "stopped"})


# ── authors ──────────────────────────────────────────────────────────────────

def team_author_ids() -> tuple[str, ...]:
    return tuple(sorted(a["author_id"] for a in _authors.authors()))


def speaker(author_id: Optional[str]) -> str:
    """Short signature: "TSDR", "Bracco". Derived from display_name "Patrick (TSDR)"."""
    if not author_id:
        return "Unknown"
    if str(author_id).startswith("guest:"):
        return "Guest"
    for a in _authors.authors():
        if a["author_id"] == author_id:
            name = a.get("display_name") or author_id
            inner = re.search(r"\(([^()]+)\)", name)
            return inner.group(1).strip() if inner else name.strip()
    return "Unknown"


def is_team(author_id: Optional[str]) -> bool:
    return bool(author_id) and author_id in team_author_ids()


# ── time ─────────────────────────────────────────────────────────────────────

def now_iso() -> str:
    return timeutil.iso_et(timeutil.now_et())


def et_date(value: Optional[str]) -> Optional[str]:
    parsed = timeutil.parse_iso(value)
    return parsed.date().isoformat() if parsed else None


def record_date(row: dict) -> Optional[str]:
    return (et_date(row.get("stated_at_et"))
            or et_date(row.get("recording_started_at_et"))
            or et_date(row.get("published_at_et")))


# ── citations ────────────────────────────────────────────────────────────────

_ADDR_UNSAFE = re.compile(r"[#@\s]+")


def locator(source_id: Optional[str], segment_id: Optional[str], *, t_start_s: Optional[float] = None,
            path: Optional[str] = None, ordinal: Optional[int] = None) -> str:
    if t_start_s is not None:
        where = f"{int(float(t_start_s))}s"
    elif path:
        where = _ADDR_UNSAFE.sub("_", str(path).strip())[:160]
    elif ordinal is not None:
        where = f"ord{int(ordinal)}"
    else:
        where = "unplaced"
    return f"wisdom:{source_id or 'unknown'}#{segment_id or 'unknown'}@{where}"


LOCATOR_RE = re.compile(r"^wisdom:[^#\s]+#[^@\s]+@\S+$")


def row_locator(row: dict) -> str:
    return locator(row.get("source_id"), row.get("segment_id"), t_start_s=row.get("t_start_s"),
                   path=row.get("seg_path"), ordinal=row.get("seg_ordinal"))


def status_label(status: Optional[str]) -> str:
    return "confirmed" if status == "confirmed" else "provisional"


# ── reads ────────────────────────────────────────────────────────────────────

def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?", (name,)
    ).fetchone() is not None


def select_records(conn: sqlite3.Connection, *, types: Sequence[str], ticker: Optional[str] = None,
                   authors: Optional[Iterable[str]] = None, since_iso: Optional[str] = None,
                   statuses: Sequence[str] = ELIGIBLE_STATUSES, extra_where: str = "",
                   extra_params: Sequence = (), order: str = "r.stated_at_et DESC",
                   limit: Optional[int] = None) -> list[dict]:
    """Team records with their segment placement and source identity.

    `authors` defaults to the team authors, which also excludes guests (their
    ids are `guest:<slug>`) and attendees (NULL). Never selects a private column."""
    author_ids = tuple(authors) if authors is not None else team_author_ids()
    if not author_ids or not types or not statuses:
        return []
    cols = ", ".join(f"r.{c}" for c in PUBLIC_RECORD_COLUMNS)
    sql = [
        f"SELECT {cols}, s.t_start_s, s.t_end_s, s.path AS seg_path, s.ordinal AS seg_ordinal,",
        " s.text AS seg_text, src.stream, src.title AS source_title, src.external_ref, src.media_pointer,",
        " src.published_at_et, src.recording_started_at_et",
        " FROM wisdom_records r",
        " JOIN wisdom_segments s ON s.segment_id = r.segment_id",
        " JOIN wisdom_sources src ON src.source_id = r.source_id",
        f" WHERE r.record_type IN ({','.join('?' * len(types))})",
        f" AND r.status IN ({','.join('?' * len(statuses))})",
        f" AND r.author_id IN ({','.join('?' * len(author_ids))})",
        " AND r.is_guest = 0",
    ]
    params: list = [*types, *statuses, *author_ids]
    if ticker:
        sql.append(" AND UPPER(r.ticker) = ?")
        params.append(normalize_ticker(ticker))
    if since_iso:
        sql.append(" AND r.stated_at_et >= ?")
        params.append(since_iso)
    if extra_where:
        sql.append(f" AND ({extra_where})")
        params.extend(extra_params)
    sql.append(f" ORDER BY {order}")
    if limit:
        sql.append(" LIMIT ?")
        params.append(int(limit))
    return [dict(r) for r in conn.execute("".join(sql), params)]


def normalize_ticker(value: object) -> str:
    return re.sub(r"[^A-Z0-9.\-]", "", str(value or "").strip().upper().lstrip("$"))


def vocab_names(conn: sqlite3.Connection) -> dict:
    if not table_exists(conn, "wisdom_vocab"):
        return {}
    return {r["vocab_id"]: r["name"] for r in conn.execute("SELECT vocab_id, name FROM wisdom_vocab")}


def vocab_map(conn: sqlite3.Connection, list_name: str) -> dict:
    """vocab_id -> external_name for one mapped list (W1 §3.2: the map is the authority)."""
    out: dict = {}
    for r in conn.execute(
            "SELECT external_name, vocab_id FROM wisdom_vocab_maps WHERE list_name = ? AND vocab_id IS NOT NULL "
            "ORDER BY mismatch ASC, external_name ASC", (list_name,)):
        out.setdefault(r["vocab_id"], r["external_name"])
    return out


# ── text ─────────────────────────────────────────────────────────────────────

_PRICE_RE = re.compile(r"\$\s?\d[\d,]*(?:\.\d+)?")
_DATE_RE = re.compile(
    r"\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b"
    r"|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b",
    re.I)
#: A bare number that stands alone (a price or level). A number glued to a
#: letter, '%' or '-' is vocabulary ("20EMA", "50%", "10-day") and stays.
_BARE_NUMBER_RE = re.compile(r"(?<![\w.$])\d+(?:,\d{3})*(?:\.\d+)?(?![\w%\-.])")


def scrub_levels_and_dates(text: Optional[str]) -> str:
    """Durable-language firewall for the dossier: prices, levels and dates out."""
    out = _PRICE_RE.sub(" ", text or "")
    out = _DATE_RE.sub(" ", out)
    out = _BARE_NUMBER_RE.sub(" ", out)
    return re.sub(r"\s{2,}", " ", out).strip(" ,;:-")


def clip(text: Optional[str], n: int) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    return t if len(t) <= n else t[: max(0, n - 1)].rstrip() + "…"


def dumps(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)


# ── writes ───────────────────────────────────────────────────────────────────

def log_publish(conn: sqlite3.Connection, consumer: str, record_ref: str, action: str, flag_env: str,
                flag_on: bool, *, at: Optional[str] = None) -> bool:
    """One wisdom_publish_log row per (consumer, ref, action, flag state, ET day).

    Callers log on CHANGE (a new or re-built ref) or one `summary:<day>` row per
    run, so the table grows with what changed, never with how often the job ran."""
    at = at or now_iso()
    state = "on" if flag_on else "off"
    if conn.execute(
            "SELECT 1 FROM wisdom_publish_log WHERE consumer = ? AND record_ref = ? AND action = ? "
            "AND flag_state = ? AND substr(at, 1, 10) = ? LIMIT 1",
            (consumer, record_ref, action, state, at[:10])).fetchone():
        return False
    conn.execute(
        "INSERT INTO wisdom_publish_log(consumer, record_ref, action, flag, flag_state, at) VALUES (?, ?, ?, ?, ?, ?)",
        (consumer, record_ref, action, flag_env, state, at))
    return True


def upsert_draft(conn: sqlite3.Connection, *, kind: str, subject_ref: str, title: str, payload: dict,
                 citations: list, provisional: bool = True, queue_tab: str = "drafts",
                 summary: Optional[str] = None, at: Optional[str] = None) -> str:
    """Insert or refresh a draft. An owner decision (approved/rejected/published) is never overwritten.

    Returns inserted | updated | unchanged | decided. A new draft also opens one
    review-queue item so the owner's queue shows it (W1 §0.3 veto model)."""
    at = at or now_iso()
    draft_id = ids.sha24("draft", kind, subject_ref)
    body, cites = dumps(payload), dumps(citations)
    sha = ids.sha256_text("\n".join((title, body, cites)))
    row = conn.execute("SELECT status, content_sha256 FROM wisdom_drafts WHERE draft_id = ?", (draft_id,)).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO wisdom_drafts(draft_id, kind, subject_ref, title, payload_json, citations_json, status, "
            "provisional, generator_version, content_sha256, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
            (draft_id, kind, subject_ref, title, body, cites, int(bool(provisional)), GENERATOR_VERSION, sha, at, at))
        conn.execute(
            "INSERT OR IGNORE INTO wisdom_review_queue(item_id, tab, subject_ref, summary, new_json, evidence_json, "
            "recommendation, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'review', 'open', ?)",
            (ids.sha24("queue", draft_id), queue_tab, f"wisdom_drafts:{draft_id}", clip(summary or title, 300),
             dumps({"draft_id": draft_id, "kind": kind}), dumps({"citations": citations[:20]}), at))
        return "inserted"
    if row["status"] != "draft":
        return "decided"
    if row["content_sha256"] == sha:
        return "unchanged"
    conn.execute(
        "UPDATE wisdom_drafts SET title = ?, payload_json = ?, citations_json = ?, provisional = ?, "
        "generator_version = ?, content_sha256 = ?, updated_at = ? WHERE draft_id = ?",
        (title, body, cites, int(bool(provisional)), GENERATOR_VERSION, sha, at, draft_id))
    return "updated"


def draft_id_for(kind: str, subject_ref: str) -> str:
    return ids.sha24("draft", kind, subject_ref)


def parse_json(value: Optional[str], default):
    try:
        out = json.loads(value) if value else default
    except (TypeError, ValueError):
        return default
    return out if isinstance(out, type(default)) else default


def session_date_of(dt: datetime) -> str:
    return timeutil.session_for(dt).isoformat()
