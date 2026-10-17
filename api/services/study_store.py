"""SQLite store for Study — the drill bank, the member's state and the
owner's review loop (spec: docs/superpowers/specs/2026-10-17-desk-practice-
interactive-education-design.md §6.1, §7.1, §13.2 T17, §13.5 P1, §13.9 #3).

DB path: /data/study.db (web service Railway volume). Dashboard-OWNED storage,
built on the education_service pattern: WAL, one module `_WRITE_LOCK`, the
schema as ONE `executescript`, `init_db()` from the lifespan, and
`contextlib.closing` on every connection (Windows teardown needs the close).

⛔ `_DB_PATH` is read with the LITERAL form `os.environ.get("STUDY_DB_PATH",
"/data/study.db")` so the repo-root conftest census pins it to the test
sandbox (T17). Tests monkeypatch the module global, as the education tests do.

THE RULES THAT LIVE HERE
  * `sym` and `forward_json` never leave `get_item_prompt` / `get_visible_bars`.
    Only `get_item_full` (admin) and `reveal_for` (after a scored attempt)
    return them. The router has no other door.
  * `review_status='approved'` is the only state member reads serve (§8.8).
  * `record_attempt` writes attempt + item state + skill + profile + weekly XP
    in ONE `BEGIN IMMEDIATE` under `_WRITE_LOCK` (T17): a crash between tables
    leaves nothing half-written, and two requests from the same member cannot
    interleave their streak/XP updates.
  * Due ladder (P1): a correct answer schedules the item back at 3, then 10,
    then 30 days; a wrong answer resets the rung and brings it back tomorrow.
  * Graduated trust (§13.9 #3): per item TYPE, `study_trust` counts clean
    approvals; the review screen asks to switch to `sampled` once the count
    reaches TRUST_ASK_AT. A fix or reject resets the count. This module only
    counts and stores the state; it never auto-approves on its own.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import secrets
import sqlite3
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Optional

_DB_PATH = os.environ.get("STUDY_DB_PATH", "/data/study.db")

_WRITE_LOCK = threading.Lock()

# ── Tunables (all plain constants so a test can read them) ───────────────────
DUE_LADDER_DAYS = (3, 10, 30)     # P1: right → next rung; wrong → +1 day, rung 0
DUE_WRONG_DAYS = 1
XP_CORRECT = 10                   # per correct answer, × difficulty
XP_WRONG = 2                      # showing up is worth something, never zero
XP_PER_LEVEL = 500
DAILY_GOAL_DEFAULT = 50
MASTERY_MIN_REPS = 8              # minimum attempts to leave Learning (§7.1)
BAND_PRACTISED = 50.0
BAND_PROFICIENT = 80.0
FRESH_DAYS = 30
TRUST_ASK_AT = 20                 # §13.9 #3: 20-30 clean approvals, then ask
TRUST_SAMPLE_RATE = 0.10          # §13.6: 10% sample once a type is trusted
STATUS_DRAFT, STATUS_APPROVED, STATUS_RETIRED, STATUS_REJECTED = (
    "draft", "approved", "retired", "rejected")
REVIEW_ACTIONS = ("approve", "fix", "reject")
TRUST_STATES = ("manual", "sampled")
BANDS = ("learning", "practised", "proficient")

#: Item types whose prompt is a chart (they carry a `bars_ref`). The set
#: composer uses `bars_ref` itself; this is the documented vocabulary (§6.1).
ITEM_TYPES = ("recall", "match", "spot", "size", "regime", "call_scan", "grade",
              "levels", "next", "family", "call_archive", "listen", "autopsy",
              "plan", "tap", "scenario")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS study_items (
  id               TEXT PRIMARY KEY,                 -- 'si_' + 12 hex
  version          INTEGER NOT NULL DEFAULT 1,
  type             TEXT NOT NULL,
  skill_id         TEXT NOT NULL,
  module           TEXT,
  difficulty       INTEGER NOT NULL DEFAULT 1,
  prompt_json      TEXT NOT NULL,
  answer_json      TEXT NOT NULL,
  reveal_json      TEXT,
  source_kind      TEXT,
  source_ref       TEXT,
  bars_ref         TEXT,
  sym              TEXT,                             -- REAL ticker; never served before scoring
  asof             TEXT,                             -- YYYY-MM-DD cutoff for chart items
  lesson_text      TEXT,
  lesson_origin    TEXT,                             -- session | template
  review_status    TEXT NOT NULL DEFAULT 'draft',    -- draft | approved | retired | rejected
  review_lane      TEXT NOT NULL DEFAULT 'manual',   -- manual | deterministic | fast | second_look
  adjustment_basis TEXT,                             -- C16: split-adjusted | as-printed
  tier_scale_id    TEXT,                             -- B2: which tier vocabulary a regime key uses
  import_flags     TEXT,                             -- JSON list of importer check failures (never silently dropped)
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  created_at       TEXT NOT NULL,
  retired_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_study_items_status_type ON study_items(review_status, type);
CREATE INDEX IF NOT EXISTS idx_study_items_skill ON study_items(skill_id, review_status);

CREATE TABLE IF NOT EXISTS study_bars (
  id           TEXT PRIMARY KEY,
  tf           TEXT NOT NULL,
  bars_json    TEXT NOT NULL,                        -- [{t,o,h,l,c,v}] through asof
  forward_json TEXT,                                 -- bars after asof; reveal/step only
  sha256       TEXT
);

CREATE TABLE IF NOT EXISTS study_corrections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL,
  item_version INTEGER,
  action       TEXT NOT NULL,                        -- fix | reject | approve
  field        TEXT,
  before_json  TEXT,
  after_json   TEXT,
  reason       TEXT,
  by_user      TEXT,
  at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_corrections_item ON study_corrections(item_id, id);

CREATE TABLE IF NOT EXISTS study_terms (
  id             TEXT PRIMARY KEY,
  term           TEXT NOT NULL,
  definition     TEXT NOT NULL,
  note           TEXT,
  aliases_json   TEXT,
  category       TEXT,
  example_quote  TEXT,
  example_source TEXT,
  bars_ref       TEXT,
  unit_ids_json  TEXT,
  difficulty     INTEGER NOT NULL DEFAULT 1,
  review_status  TEXT NOT NULL DEFAULT 'draft'
);
CREATE INDEX IF NOT EXISTS idx_study_terms_cat ON study_terms(category, review_status);

CREATE TABLE IF NOT EXISTS study_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  item_version INTEGER,
  started_at   TEXT,
  answered_at  TEXT NOT NULL,
  answer_json  TEXT,
  correct      INTEGER NOT NULL,
  score        REAL NOT NULL DEFAULT 0,
  time_ms      INTEGER,
  session_id   TEXT,
  due_at       TEXT                                  -- P1: when this item comes back
);
CREATE INDEX IF NOT EXISTS idx_study_attempts_user_item ON study_attempts(user_id, item_id, id);
CREATE INDEX IF NOT EXISTS idx_study_attempts_session ON study_attempts(session_id, id);

-- One row per (member, item): the due ladder's rung and the miss count the
-- set composer weights on. Derivable from study_attempts, kept so `list_due`
-- and `compose_today` are one indexed read each.
CREATE TABLE IF NOT EXISTS study_item_state (
  user_id      TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  rung         INTEGER NOT NULL DEFAULT 0,           -- index into DUE_LADDER_DAYS
  due_at       TEXT,
  last_correct INTEGER,
  misses       INTEGER NOT NULL DEFAULT 0,
  reps         INTEGER NOT NULL DEFAULT 0,
  last_at      TEXT,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_study_item_state_due ON study_item_state(user_id, due_at);

CREATE TABLE IF NOT EXISTS study_skill (
  user_id  TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  mastery  REAL NOT NULL DEFAULT 0,
  reps     INTEGER NOT NULL DEFAULT 0,
  last_at  TEXT,
  band     TEXT NOT NULL DEFAULT 'learning',
  fresh    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS study_profile (
  user_id               TEXT PRIMARY KEY,
  xp                    INTEGER NOT NULL DEFAULT 0,
  level                 INTEGER NOT NULL DEFAULT 1,
  streak                INTEGER NOT NULL DEFAULT 0,
  streak_best           INTEGER NOT NULL DEFAULT 0,
  last_done_day         TEXT,
  freeze_used_week      TEXT,
  daily_goal            INTEGER NOT NULL DEFAULT 50,
  reminder_time         TEXT,                        -- HH:MM in the member's own zone
  reminder_tz           TEXT,                        -- IANA zone; NULL = America/New_York
  reminder_on           INTEGER NOT NULL DEFAULT 0,
  leaderboard_optout    INTEGER NOT NULL DEFAULT 0,
  journal_autopsy_optin INTEGER NOT NULL DEFAULT 0,
  placement_json        TEXT,
  display_name          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,                       -- daily | skill | checkpoint | refresher | free
  skill_id      TEXT,
  day_et        TEXT,                                -- daily sessions: the ET day they belong to
  created_at    TEXT NOT NULL,
  finished_at   TEXT,
  item_ids_json TEXT NOT NULL,
  result_json   TEXT
);
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_day ON study_sessions(user_id, kind, day_et);

CREATE TABLE IF NOT EXISTS study_badges (
  user_id   TEXT NOT NULL,
  badge_id  TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS study_checkpoints (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            TEXT NOT NULL,
  module             TEXT NOT NULL,
  attempt_no         INTEGER NOT NULL DEFAULT 1,
  passed             INTEGER NOT NULL DEFAULT 0,
  score              REAL,
  missed_skills_json TEXT,
  at                 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_weekly_xp (
  user_id TEXT NOT NULL,
  week_et TEXT NOT NULL,                             -- Monday of the ET week, YYYY-MM-DD
  xp      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, week_et)
);
CREATE INDEX IF NOT EXISTS idx_study_weekly_xp_week ON study_weekly_xp(week_et, xp);

CREATE TABLE IF NOT EXISTS study_reminder_log (
  user_id TEXT NOT NULL,
  day_et  TEXT NOT NULL,
  PRIMARY KEY (user_id, day_et)
);

CREATE TABLE IF NOT EXISTS study_trust (
  item_type   TEXT PRIMARY KEY,
  clean_count INTEGER NOT NULL DEFAULT 0,
  state       TEXT NOT NULL DEFAULT 'manual',        -- manual | sampled
  sample_rate REAL NOT NULL DEFAULT 0.1,
  updated_at  TEXT
);

-- The frozen weekly leaderboard (study_weekly_close job, Sunday 23:59 ET).
-- One row per closed ET week; the boot catch-up compares this to the weeks
-- that hold XP and closes any it missed.
CREATE TABLE IF NOT EXISTS study_weekly_close (
  week_et   TEXT PRIMARY KEY,
  closed_at TEXT NOT NULL,
  rows_json TEXT NOT NULL
);
"""

#: Columns added after the first schema shipped. `CREATE TABLE IF NOT EXISTS`
#: cannot add a column to an existing table, so each is an idempotent ALTER.
_ALTERS = (
    ("study_items", "import_flags", "TEXT"),
    ("study_profile", "reminder_tz", "TEXT"),
)

_ITEM_CONTENT_FIELDS = (
    "type", "skill_id", "module", "difficulty", "prompt_json", "answer_json",
    "reveal_json", "source_kind", "source_ref", "bars_ref", "sym", "asof",
    "lesson_text", "lesson_origin", "adjustment_basis", "tier_scale_id",
    "review_lane", "import_flags",
)
_JSON_FIELDS = ("prompt_json", "answer_json", "reveal_json", "import_flags")

#: Fields a member-facing prompt may carry. ⛔ `sym`, `answer_json`,
#: `reveal_json`, `lesson_text` and `source_ref` are NOT here on purpose.
_PROMPT_FIELDS = ("id", "version", "type", "skill_id", "module", "difficulty",
                  "prompt_json", "bars_ref", "tier_scale_id")

#: Columns a member may write through PUT /profile.
PROFILE_EDITABLE = ("daily_goal", "reminder_time", "reminder_tz", "reminder_on",
                    "leaderboard_optout", "journal_autopsy_optin",
                    "placement_json", "display_name")


# ── Time helpers ─────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def et_day_of(dt: Optional[datetime] = None) -> str:
    """The ET calendar day of `dt` (UTC now when None), YYYY-MM-DD. Falls back
    to a fixed -4 h when tzdata is absent (the ai_population_cap precedent)."""
    dt = dt or _now_utc()
    try:
        from zoneinfo import ZoneInfo
        return dt.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001 -- no tzdata on this box
        return (dt.astimezone(timezone.utc) - timedelta(hours=4)).strftime("%Y-%m-%d")


def week_of(day: str) -> str:
    """Monday of the ET week that holds `day` (YYYY-MM-DD)."""
    d = date.fromisoformat(day)
    return (d - timedelta(days=d.weekday())).isoformat()


# ── Connections ───────────────────────────────────────────────────────────────

def _connect() -> sqlite3.Connection:
    # isolation_level=None: the module never auto-opens a transaction, so the
    # explicit BEGIN IMMEDIATE below is the ONLY transaction that exists.
    conn = sqlite3.connect(_DB_PATH, timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        for table, col, decl in _ALTERS:
            cols = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
            if col not in cols:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


@contextlib.contextmanager
def _write():
    """ONE `BEGIN IMMEDIATE` under the module lock; commit on success, roll
    back on any exception (the daily_counters pattern)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("BEGIN IMMEDIATE")
        try:
            yield c
            c.execute("COMMIT")
        except BaseException:
            if c.in_transaction:
                c.execute("ROLLBACK")
            raise


def _loads(s: Optional[str], default=None):
    if s is None or s == "":
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


def _dumps(v) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, str):
        return v
    return json.dumps(v, separators=(",", ":"), sort_keys=True)


def new_item_id() -> str:
    return "si_" + secrets.token_hex(6)


def new_session_id() -> str:
    return "ss_" + secrets.token_hex(8)


def bars_sha256(bars: list) -> str:
    """sha256 of the canonical compact JSON of a bar list — the value an
    authoring session records and the importer checks (§6.2)."""
    return hashlib.sha256(
        json.dumps(bars, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


# ── Items ─────────────────────────────────────────────────────────────────────

def upsert_items(items: Iterable[dict], *, now: Optional[datetime] = None) -> dict:
    """Insert or update bank items. `review_status` defaults to 'draft' and a
    re-import with a HIGHER version resets an approved item to draft (nothing
    goes live unreviewed, §8.8); a re-import at the same version keeps the
    status the owner gave it. Returns {inserted, updated, ids}."""
    stamp = _iso(now or _now_utc())
    inserted = updated = 0
    ids: list[str] = []
    with _write() as c:
        for raw in items:
            it = dict(raw)
            iid = it.get("id") or new_item_id()
            if not it.get("type") or not it.get("skill_id"):
                raise ValueError(f"item {iid}: type and skill_id are required")
            if it.get("prompt_json") is None or it.get("answer_json") is None:
                raise ValueError(f"item {iid}: prompt_json and answer_json are required")
            vals = {k: it.get(k) for k in _ITEM_CONTENT_FIELDS}
            for k in _JSON_FIELDS:
                vals[k] = _dumps(vals[k])
            vals["difficulty"] = int(vals.get("difficulty") or 1)
            vals["review_lane"] = vals.get("review_lane") or "manual"
            version = int(it.get("version") or 1)
            status = it.get("review_status") or STATUS_DRAFT
            row = c.execute("SELECT version, review_status FROM study_items WHERE id=?",
                            (iid,)).fetchone()
            if row is None:
                c.execute(
                    f"INSERT INTO study_items (id, version, review_status, created_at, "
                    f"{', '.join(_ITEM_CONTENT_FIELDS)}) VALUES (?, ?, ?, ?, "
                    f"{', '.join('?' for _ in _ITEM_CONTENT_FIELDS)})",
                    (iid, version, status, stamp, *[vals[k] for k in _ITEM_CONTENT_FIELDS]),
                )
                inserted += 1
            else:
                new_status = row["review_status"]
                if version > int(row["version"] or 1):
                    new_status = STATUS_DRAFT
                sets = ", ".join(f"{k}=?" for k in _ITEM_CONTENT_FIELDS)
                c.execute(
                    f"UPDATE study_items SET {sets}, version=?, review_status=? WHERE id=?",
                    (*[vals[k] for k in _ITEM_CONTENT_FIELDS],
                     max(version, int(row["version"] or 1)), new_status, iid),
                )
                updated += 1
            ids.append(iid)
    return {"inserted": inserted, "updated": updated, "ids": ids}


def upsert_bars(bars_id: str, tf: str, bars: list, forward: Optional[list] = None,
                sha256: Optional[str] = None) -> str:
    """Store a hermetic bar snapshot. Returns the sha256 of the visible window."""
    digest = sha256 or bars_sha256(bars)
    with _write() as c:
        c.execute(
            "INSERT INTO study_bars (id, tf, bars_json, forward_json, sha256) VALUES (?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET tf=excluded.tf, bars_json=excluded.bars_json, "
            "forward_json=excluded.forward_json, sha256=excluded.sha256",
            (bars_id, tf, _dumps(bars), _dumps(forward) if forward is not None else None, digest),
        )
    return digest


def _row_to_item(row: sqlite3.Row) -> dict:
    d = dict(row)
    for k in _JSON_FIELDS:
        if k in d:
            d[k] = _loads(d[k])
    return d


def get_item_full(item_id: str) -> Optional[dict]:
    """ADMIN ONLY: the whole row, key and ticker included."""
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM study_items WHERE id=?", (item_id,)).fetchone()
    return _row_to_item(row) if row else None


def get_item_prompt(item_id: str, *, approved_only: bool = True) -> Optional[dict]:
    """What a member sees: NEVER `sym`, NEVER the key, NEVER forward bars.
    `has_chart` tells the player whether to ask for bars."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            f"SELECT {', '.join(_PROMPT_FIELDS)} FROM study_items WHERE id=?", (item_id,)
        ).fetchone() if not approved_only else c.execute(
            f"SELECT {', '.join(_PROMPT_FIELDS)} FROM study_items WHERE id=? AND review_status=?",
            (item_id, STATUS_APPROVED),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["prompt_json"] = _loads(d.get("prompt_json"), {})
    d["has_chart"] = bool(d.pop("bars_ref", None))
    return d


def get_visible_bars(item_id: str, *, approved_only: bool = True) -> Optional[dict]:
    """The visible window for an item, with `symbol` = the item id (§6.1).
    No `sym`, no forward bars, no sha."""
    with contextlib.closing(_connect()) as c:
        q = ("SELECT i.id AS item_id, b.tf, b.bars_json FROM study_items i "
             "JOIN study_bars b ON b.id = i.bars_ref WHERE i.id=?")
        args: tuple = (item_id,)
        if approved_only:
            q += " AND i.review_status=?"
            args = (item_id, STATUS_APPROVED)
        row = c.execute(q, args).fetchone()
    if not row:
        return None
    return {"symbol": row["item_id"], "tf": row["tf"], "bars": _loads(row["bars_json"], [])}


def get_forward_bars(item_id: str) -> list:
    """Forward bars for an item. ⛔ Callers must have verified a scored attempt
    exists for this member and item (`attempt_exists`) before serving these."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT b.forward_json FROM study_items i JOIN study_bars b ON b.id=i.bars_ref "
            "WHERE i.id=?", (item_id,)).fetchone()
    return _loads(row["forward_json"], []) if row else []


def reveal_for(item: dict) -> dict:
    """The post-scoring reveal from a FULL item row: ticker, dates, provenance,
    lesson, the recorded outcome. Forward bars are added by the router."""
    reveal = dict(item.get("reveal_json") or {})
    reveal.setdefault("sym", item.get("sym"))
    reveal.setdefault("asof", item.get("asof"))
    reveal["provenance"] = {"source_kind": item.get("source_kind"),
                            "source_ref": item.get("source_ref"),
                            "adjustment_basis": item.get("adjustment_basis"),
                            "tier_scale_id": item.get("tier_scale_id")}
    reveal["lesson"] = item.get("lesson_text")
    reveal["lesson_origin"] = item.get("lesson_origin")
    reveal["answer"] = item.get("answer_json")
    return reveal


def list_bank(*, status: str = STATUS_APPROVED, types: Optional[Iterable[str]] = None,
              limit: int = 5000) -> list[dict]:
    """Lightweight candidate rows for the set composer: id, type, skill_id,
    difficulty, has_chart. Never the key, never the ticker."""
    q = ("SELECT id, type, skill_id, difficulty, (bars_ref IS NOT NULL) AS has_chart "
         "FROM study_items WHERE review_status=?")
    args: list = [status]
    if types:
        ts = list(types)
        q += f" AND type IN ({','.join('?' for _ in ts)})"
        args += ts
    q += " ORDER BY id LIMIT ?"
    args.append(int(limit))
    with contextlib.closing(_connect()) as c:
        rows = c.execute(q, args).fetchall()
    return [{"id": r["id"], "type": r["type"], "skill_id": r["skill_id"],
             "difficulty": int(r["difficulty"] or 1), "has_chart": bool(r["has_chart"])}
            for r in rows]


def list_drafts(*, lane: Optional[str] = None, item_type: Optional[str] = None,
                limit: int = 150) -> list[dict]:
    """ADMIN: draft items, oldest first, optionally by lane / type. Full rows
    (the review card needs the key and the ticker)."""
    q = "SELECT * FROM study_items WHERE review_status=?"
    args: list = [STATUS_DRAFT]
    if lane:
        q += " AND review_lane=?"
        args.append(lane)
    if item_type:
        q += " AND type=?"
        args.append(item_type)
    q += " ORDER BY created_at, id LIMIT ?"
    args.append(int(limit))
    with contextlib.closing(_connect()) as c:
        rows = c.execute(q, args).fetchall()
    return [_row_to_item(r) for r in rows]


def draft_counts() -> dict:
    """{lane: {type: n}} of drafts waiting — the review queue header."""
    out: dict = {}
    with contextlib.closing(_connect()) as c:
        for r in c.execute(
                "SELECT review_lane, type, COUNT(*) AS n FROM study_items "
                "WHERE review_status=? GROUP BY review_lane, type", (STATUS_DRAFT,)):
            out.setdefault(r["review_lane"], {})[r["type"]] = int(r["n"])
    return out


# ── Terms (§4.8b) ─────────────────────────────────────────────────────────────

_TERM_FIELDS = ("term", "definition", "note", "aliases_json", "category", "example_quote",
                "example_source", "bars_ref", "unit_ids_json", "difficulty", "review_status")


def upsert_terms(terms: Iterable[dict]) -> int:
    n = 0
    with _write() as c:
        for raw in terms:
            t = dict(raw)
            tid = t.get("id") or ("st_" + secrets.token_hex(6))
            if not t.get("term") or not t.get("definition"):
                raise ValueError(f"term {tid}: term and definition are required")
            vals = {k: t.get(k) for k in _TERM_FIELDS}
            vals["aliases_json"] = _dumps(vals["aliases_json"])
            vals["unit_ids_json"] = _dumps(vals["unit_ids_json"])
            vals["difficulty"] = int(vals.get("difficulty") or 1)
            vals["review_status"] = vals.get("review_status") or STATUS_DRAFT
            sets = ", ".join(f"{k}=excluded.{k}" for k in _TERM_FIELDS)
            c.execute(
                f"INSERT INTO study_terms (id, {', '.join(_TERM_FIELDS)}) VALUES "
                f"(?, {', '.join('?' for _ in _TERM_FIELDS)}) ON CONFLICT(id) DO UPDATE SET {sets}",
                (tid, *[vals[k] for k in _TERM_FIELDS]),
            )
            n += 1
    return n


def get_term(term_id: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM study_terms WHERE id=?", (term_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["aliases_json"] = _loads(d["aliases_json"], [])
    d["unit_ids_json"] = _loads(d["unit_ids_json"], [])
    return d


# ── Profile ───────────────────────────────────────────────────────────────────

def _ensure_profile(c: sqlite3.Connection, user_id: str, stamp: str) -> sqlite3.Row:
    row = c.execute("SELECT * FROM study_profile WHERE user_id=?", (user_id,)).fetchone()
    if row is None:
        c.execute("INSERT INTO study_profile (user_id, daily_goal, created_at) VALUES (?,?,?)",
                  (user_id, DAILY_GOAL_DEFAULT, stamp))
        row = c.execute("SELECT * FROM study_profile WHERE user_id=?", (user_id,)).fetchone()
    return row


def get_profile(user_id: str, *, create: bool = True) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM study_profile WHERE user_id=?", (user_id,)).fetchone()
    if row is None:
        if not create:
            return None
        with _write() as c:
            row = _ensure_profile(c, user_id, _iso(_now_utc()))
    d = dict(row)
    d["placement_json"] = _loads(d.get("placement_json"))
    return d


def update_profile(user_id: str, patch: dict) -> dict:
    """Write the member-editable fields only (PROFILE_EDITABLE)."""
    clean = {k: v for k, v in (patch or {}).items() if k in PROFILE_EDITABLE}
    if "daily_goal" in clean:
        g = int(clean["daily_goal"] or DAILY_GOAL_DEFAULT)
        clean["daily_goal"] = max(10, min(500, g))
    for k in ("reminder_on", "leaderboard_optout", "journal_autopsy_optin"):
        if k in clean:
            clean[k] = 1 if clean[k] else 0
    if "placement_json" in clean:
        clean["placement_json"] = _dumps(clean["placement_json"])
    if "display_name" in clean and clean["display_name"] is not None:
        clean["display_name"] = str(clean["display_name"]).strip()[:40] or None
    if "reminder_tz" in clean and clean["reminder_tz"] is not None:
        clean["reminder_tz"] = str(clean["reminder_tz"]).strip()[:64] or None
    stamp = _iso(_now_utc())
    with _write() as c:
        _ensure_profile(c, user_id, stamp)
        if clean:
            sets = ", ".join(f"{k}=?" for k in clean)
            c.execute(f"UPDATE study_profile SET {sets}, updated_at=? WHERE user_id=?",
                      (*clean.values(), stamp, user_id))
    return get_profile(user_id)


# ── Sessions ─────────────────────────────────────────────────────────────────

def create_session(user_id: str, kind: str, item_ids: list[str], *, skill_id: Optional[str] = None,
                   day_et: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    sid = new_session_id()
    stamp = _iso(now or _now_utc())
    with _write() as c:
        c.execute(
            "INSERT INTO study_sessions (id, user_id, kind, skill_id, day_et, created_at, item_ids_json) "
            "VALUES (?,?,?,?,?,?,?)",
            (sid, user_id, kind, skill_id, day_et, stamp, _dumps(list(item_ids))),
        )
    return get_session(sid)


def get_session(session_id: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM study_sessions WHERE id=?", (session_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["item_ids"] = _loads(d.pop("item_ids_json"), [])
    d["result"] = _loads(d.pop("result_json"))
    return d


def get_daily_session(user_id: str, day_et: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT id FROM study_sessions WHERE user_id=? AND kind='daily' AND day_et=? "
            "ORDER BY created_at DESC LIMIT 1", (user_id, day_et)).fetchone()
    return get_session(row["id"]) if row else None


def answered_item_ids(user_id: str, session_id: str) -> list[str]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT DISTINCT item_id FROM study_attempts WHERE user_id=? AND session_id=? ORDER BY id",
            (user_id, session_id)).fetchall()
    return [r["item_id"] for r in rows]


def finish_session(session_id: str, result: Optional[dict] = None) -> None:
    with _write() as c:
        c.execute("UPDATE study_sessions SET finished_at=?, result_json=? WHERE id=?",
                  (_iso(_now_utc()), _dumps(result), session_id))


# ── Attempts: the ONE transaction (T17) ───────────────────────────────────────

def _mastery_from_attempts(rows: list, now: datetime) -> float:
    """§7.1: mastery = 100 × Σ w·s / Σ w, w = 2^(−age_days/30) × difficulty."""
    num = den = 0.0
    for r in rows:
        try:
            at = datetime.fromisoformat(r["answered_at"])
        except (TypeError, ValueError):
            at = now
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        age = max(0.0, (now - at).total_seconds() / 86400.0)
        w = (2.0 ** (-age / 30.0)) * float(r["difficulty"] or 1)
        num += w * float(r["score"] or 0.0)
        den += w
    return round(100.0 * num / den, 2) if den else 0.0


def _band(mastery: float, reps: int) -> str:
    if reps < MASTERY_MIN_REPS or mastery < BAND_PRACTISED:
        return "learning"
    return "proficient" if mastery >= BAND_PROFICIENT else "practised"


def _streak_after(profile: sqlite3.Row, today: str) -> tuple[int, int, str, Optional[str]]:
    """(streak, streak_best, last_done_day, freeze_used_week) after the member
    FINISHES the daily set on `today` (ET) — §4.5: "finishing it keeps the
    streak", so a single answered item never credits a day. One missed day a
    week is forgiven (D14: "a free day each week"); the week key is the Monday
    of `today`'s week."""
    streak = int(profile["streak"] or 0)
    best = int(profile["streak_best"] or 0)
    last = profile["last_done_day"]
    freeze_week = profile["freeze_used_week"]
    if last == today:
        return streak, best, last, freeze_week
    this_week = week_of(today)
    if last:
        gap = (date.fromisoformat(today) - date.fromisoformat(last)).days
    else:
        gap = None
    if gap == 1:
        streak += 1
    elif gap == 2 and freeze_week != this_week and streak > 0:
        streak += 1                      # the free day covered yesterday
        freeze_week = this_week
    else:
        streak = 1
    best = max(best, streak)
    return streak, best, today, freeze_week


def record_attempt(user_id: str, item_id: str, answer_json, correct: bool, score: float,
                   time_ms: Optional[int] = None, session_id: Optional[str] = None,
                   *, now: Optional[datetime] = None) -> dict:
    """Write the attempt and every derived row in ONE `BEGIN IMMEDIATE`:
    study_attempts (+due_at), study_item_state (ladder rung, misses),
    study_skill (mastery/band/fresh), study_profile (xp/level/streak),
    study_weekly_xp. Raises ValueError when the item does not exist.

    Returns {attempt_id, due_at, xp_gained, xp, level, streak, streak_best,
    skill: {skill_id, mastery, band, reps}, week_et, weekly_xp}."""
    now = now or _now_utc()
    stamp = _iso(now)
    today = et_day_of(now)
    week = week_of(today)
    correct_i = 1 if correct else 0
    score_f = max(0.0, min(1.0, float(score)))
    with _write() as c:
        item = c.execute("SELECT id, version, skill_id, difficulty FROM study_items WHERE id=?",
                         (item_id,)).fetchone()
        if item is None:
            raise ValueError(f"unknown item {item_id}")
        difficulty = int(item["difficulty"] or 1)

        # 1. due ladder (P1)
        state = c.execute("SELECT rung, misses, reps FROM study_item_state WHERE user_id=? AND item_id=?",
                          (user_id, item_id)).fetchone()
        rung = int(state["rung"]) if state else 0
        misses = int(state["misses"]) if state else 0
        reps_item = int(state["reps"]) if state else 0
        if correct_i:
            due_days = DUE_LADDER_DAYS[min(rung, len(DUE_LADDER_DAYS) - 1)]
            rung = min(rung + 1, len(DUE_LADDER_DAYS) - 1)
        else:
            due_days = DUE_WRONG_DAYS
            rung = 0
            misses += 1
        due_at = _iso(now + timedelta(days=due_days))
        c.execute(
            "INSERT INTO study_item_state (user_id, item_id, rung, due_at, last_correct, misses, reps, last_at) "
            "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id, item_id) DO UPDATE SET rung=excluded.rung, "
            "due_at=excluded.due_at, last_correct=excluded.last_correct, misses=excluded.misses, "
            "reps=excluded.reps, last_at=excluded.last_at",
            (user_id, item_id, rung, due_at, correct_i, misses, reps_item + 1, stamp),
        )

        # 2. the attempt row
        cur = c.execute(
            "INSERT INTO study_attempts (user_id, item_id, item_version, answered_at, answer_json, "
            "correct, score, time_ms, session_id, due_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (user_id, item_id, int(item["version"] or 1), stamp, _dumps(answer_json), correct_i,
             score_f, int(time_ms) if time_ms is not None else None, session_id, due_at),
        )
        attempt_id = int(cur.lastrowid)

        # 3. skill (mastery over this skill's attempts, age-weighted)
        skill_id = item["skill_id"]
        rows = c.execute(
            "SELECT a.answered_at, a.score, i.difficulty FROM study_attempts a "
            "JOIN study_items i ON i.id = a.item_id WHERE a.user_id=? AND i.skill_id=? "
            "ORDER BY a.id DESC LIMIT 200", (user_id, skill_id)).fetchall()
        reps = len(rows)
        mastery = _mastery_from_attempts(rows, now)
        band = _band(mastery, reps)
        c.execute(
            "INSERT INTO study_skill (user_id, skill_id, mastery, reps, last_at, band, fresh) "
            "VALUES (?,?,?,?,?,?,1) ON CONFLICT(user_id, skill_id) DO UPDATE SET mastery=excluded.mastery, "
            "reps=excluded.reps, last_at=excluded.last_at, band=excluded.band, fresh=1",
            (user_id, skill_id, mastery, reps, stamp, band),
        )

        # 4. profile: xp / level; the streak ONLY when this answer finishes
        #    the member's daily set (§4.5) — the session row is marked finished
        #    in the same transaction so the credit can never happen twice.
        prof = _ensure_profile(c, user_id, stamp)
        gained = (XP_CORRECT * difficulty) if correct_i else XP_WRONG
        xp = int(prof["xp"] or 0) + gained
        level = 1 + xp // XP_PER_LEVEL
        streak = int(prof["streak"] or 0)
        best = int(prof["streak_best"] or 0)
        last_day = prof["last_done_day"]
        freeze_week = prof["freeze_used_week"]
        daily_done = False
        if session_id:
            sess = c.execute(
                "SELECT kind, day_et, finished_at, item_ids_json FROM study_sessions "
                "WHERE id=? AND user_id=?", (session_id, user_id)).fetchone()
            if sess and sess["kind"] == "daily" and not sess["finished_at"]:
                ids = [i for i in (_loads(sess["item_ids_json"], []) or []) if i]
                if ids:
                    marks = ",".join("?" for _ in ids)
                    n_done = c.execute(
                        f"SELECT COUNT(DISTINCT item_id) AS n FROM study_attempts WHERE user_id=? "
                        f"AND session_id=? AND item_id IN ({marks})",
                        (user_id, session_id, *ids)).fetchone()["n"]
                    if int(n_done) >= len(ids):
                        daily_done = True
                        n_right = c.execute(
                            "SELECT COUNT(*) AS n FROM (SELECT item_id, MAX(correct) AS c FROM study_attempts "
                            "WHERE user_id=? AND session_id=? GROUP BY item_id) WHERE c=1",
                            (user_id, session_id)).fetchone()["n"]
                        c.execute("UPDATE study_sessions SET finished_at=?, result_json=? WHERE id=?",
                                  (stamp, _dumps({"answered": len(ids), "correct": int(n_right)}),
                                   session_id))
                        streak, best, last_day, freeze_week = _streak_after(
                            prof, sess["day_et"] or today)
        c.execute(
            "UPDATE study_profile SET xp=?, level=?, streak=?, streak_best=?, last_done_day=?, "
            "freeze_used_week=?, updated_at=? WHERE user_id=?",
            (xp, level, streak, best, last_day, freeze_week, stamp, user_id),
        )

        # 5. weekly xp
        c.execute(
            "INSERT INTO study_weekly_xp (user_id, week_et, xp) VALUES (?,?,?) "
            "ON CONFLICT(user_id, week_et) DO UPDATE SET xp = xp + excluded.xp",
            (user_id, week, gained),
        )
        wk = c.execute("SELECT xp FROM study_weekly_xp WHERE user_id=? AND week_et=?",
                       (user_id, week)).fetchone()
    return {
        "attempt_id": attempt_id, "due_at": due_at, "xp_gained": gained, "xp": xp,
        "level": level, "streak": streak, "streak_best": best, "daily_done": daily_done,
        "skill": {"skill_id": skill_id, "mastery": mastery, "band": band, "reps": reps},
        "week_et": week, "weekly_xp": int(wk["xp"]) if wk else gained,
    }


def get_attempt(attempt_id: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM study_attempts WHERE id=?", (int(attempt_id),)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["answer_json"] = _loads(d["answer_json"])
    return d


def attempt_exists(user_id: str, item_id: str) -> bool:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT 1 FROM study_attempts WHERE user_id=? AND item_id=? LIMIT 1",
                        (user_id, item_id)).fetchone()
    return row is not None


# ── Reads the set composer needs ──────────────────────────────────────────────

def list_due(user_id: str, limit: int = 3, *, now: Optional[datetime] = None) -> list[dict]:
    """Approved items whose due_at has passed, vocabulary first (§4.8b: "first
    in line for the 3 due slots"), then the longest overdue. Then, if slots
    remain, one item from each STALE skill (fresh=0) the member has touched."""
    now_s = _iso(now or _now_utc())
    out: list[dict] = []
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT s.item_id AS id, i.type, i.skill_id, i.difficulty, (i.bars_ref IS NOT NULL) AS has_chart, "
            "s.due_at FROM study_item_state s JOIN study_items i ON i.id = s.item_id "
            "WHERE s.user_id=? AND s.due_at IS NOT NULL AND s.due_at <= ? AND i.review_status=? "
            "ORDER BY (i.skill_id LIKE 'vocab.%') DESC, s.due_at ASC LIMIT ?",
            (user_id, now_s, STATUS_APPROVED, int(limit))).fetchall()
        out = [{"id": r["id"], "type": r["type"], "skill_id": r["skill_id"],
                "difficulty": int(r["difficulty"] or 1), "has_chart": bool(r["has_chart"]),
                "due_at": r["due_at"], "why": "due"} for r in rows]
        if len(out) < limit:
            seen = {r["id"] for r in out}
            stale = c.execute(
                "SELECT skill_id FROM study_skill WHERE user_id=? AND fresh=0 ORDER BY last_at ASC LIMIT ?",
                (user_id, int(limit) - len(out))).fetchall()
            for s in stale:
                r = next((row for row in c.execute(
                    "SELECT id, type, skill_id, difficulty, (bars_ref IS NOT NULL) AS has_chart "
                    "FROM study_items WHERE skill_id=? AND review_status=? ORDER BY RANDOM() LIMIT 8",
                    (s["skill_id"], STATUS_APPROVED)) if row["id"] not in seen), None)
                if r is not None:
                    seen.add(r["id"])
                    out.append({"id": r["id"], "type": r["type"], "skill_id": r["skill_id"],
                                "difficulty": int(r["difficulty"] or 1),
                                "has_chart": bool(r["has_chart"]), "due_at": None, "why": "stale"})
    return out[:limit]


def missed_item_ids(user_id: str) -> set[str]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT item_id FROM study_item_state WHERE user_id=? AND misses > 0",
                         (user_id,)).fetchall()
    return {r["item_id"] for r in rows}


def weak_skill_ids(user_id: str) -> set[str]:
    """Skills below Practised (band = learning) — the 2× weight in §7.1."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT skill_id FROM study_skill WHERE user_id=? AND band='learning'",
                         (user_id,)).fetchall()
    return {r["skill_id"] for r in rows}


def list_skills(user_id: str) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT * FROM study_skill WHERE user_id=? ORDER BY skill_id",
                         (user_id,)).fetchall()
    return [dict(r) for r in rows]


def refresh_freshness(user_id: str, *, now: Optional[datetime] = None) -> int:
    """fresh = last_at within FRESH_DAYS (§7.1). Returns rows marked stale."""
    cutoff = _iso((now or _now_utc()) - timedelta(days=FRESH_DAYS))
    with _write() as c:
        cur = c.execute("UPDATE study_skill SET fresh=0 WHERE user_id=? AND fresh=1 AND last_at < ?",
                        (user_id, cutoff))
        return int(cur.rowcount or 0)


# ── Leaderboard ───────────────────────────────────────────────────────────────

def leaderboard(week_et: str, *, top: int = 10, user_id: Optional[str] = None) -> dict:
    """Top `top` by weekly XP, EXCLUDING members with leaderboard_optout=1
    (§8.7); plus the caller's own rank whether or not they opted out."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT w.user_id, w.xp, p.display_name FROM study_weekly_xp w "
            "LEFT JOIN study_profile p ON p.user_id = w.user_id "
            "WHERE w.week_et=? AND COALESCE(p.leaderboard_optout, 0)=0 "
            "ORDER BY w.xp DESC, w.user_id ASC LIMIT ?", (week_et, int(top))).fetchall()
        you = None
        if user_id:
            mine = c.execute("SELECT xp FROM study_weekly_xp WHERE user_id=? AND week_et=?",
                             (user_id, week_et)).fetchone()
            if mine:
                ahead = c.execute(
                    "SELECT COUNT(*) AS n FROM study_weekly_xp w LEFT JOIN study_profile p "
                    "ON p.user_id = w.user_id WHERE w.week_et=? AND w.xp > ? "
                    "AND COALESCE(p.leaderboard_optout, 0)=0", (week_et, int(mine["xp"]))).fetchone()
                you = {"rank": int(ahead["n"]) + 1, "xp": int(mine["xp"])}
    out_rows = []
    for i, r in enumerate(rows, 1):
        out_rows.append({"rank": i, "xp": int(r["xp"]),
                         "display_name": r["display_name"] or "Member",
                         "you": bool(user_id and r["user_id"] == user_id)})
    return {"week_et": week_et, "rows": out_rows, "you": you}


# ── Review loop + graduated trust (§13.9 #3) ──────────────────────────────────

def trust_state(item_type: str) -> dict:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM study_trust WHERE item_type=?", (item_type,)).fetchone()
    if not row:
        return {"item_type": item_type, "clean_count": 0, "state": "manual",
                "sample_rate": TRUST_SAMPLE_RATE, "ask_to_switch": False, "ask_at": TRUST_ASK_AT}
    d = dict(row)
    d["ask_to_switch"] = d["state"] == "manual" and int(d["clean_count"]) >= TRUST_ASK_AT
    d["ask_at"] = TRUST_ASK_AT
    return d


def set_trust_state(item_type: str, state: str, *, sample_rate: Optional[float] = None) -> dict:
    """The owner's answer to "switch this type to sampled?". Only the owner
    flips it; nothing in this module flips it on its own."""
    if state not in TRUST_STATES:
        raise ValueError(f"trust state must be one of {TRUST_STATES}")
    rate = float(sample_rate if sample_rate is not None else TRUST_SAMPLE_RATE)
    with _write() as c:
        c.execute(
            "INSERT INTO study_trust (item_type, clean_count, state, sample_rate, updated_at) "
            "VALUES (?,0,?,?,?) ON CONFLICT(item_type) DO UPDATE SET state=excluded.state, "
            "sample_rate=excluded.sample_rate, updated_at=excluded.updated_at",
            (item_type, state, rate, _iso(_now_utc())))
    return trust_state(item_type)


def reset_trust(item_type: str) -> None:
    """A new generator, source or template resets the count (§13.9 #3)."""
    with _write() as c:
        c.execute(
            "INSERT INTO study_trust (item_type, clean_count, state, sample_rate, updated_at) "
            "VALUES (?,0,'manual',?,?) ON CONFLICT(item_type) DO UPDATE SET clean_count=0, "
            "state='manual', updated_at=excluded.updated_at",
            (item_type, TRUST_SAMPLE_RATE, _iso(_now_utc())))


def _bump_trust(c: sqlite3.Connection, item_type: str, clean: bool, stamp: str) -> None:
    if clean:
        c.execute(
            "INSERT INTO study_trust (item_type, clean_count, state, sample_rate, updated_at) "
            "VALUES (?,1,'manual',?,?) ON CONFLICT(item_type) DO UPDATE SET "
            "clean_count = clean_count + 1, updated_at=excluded.updated_at",
            (item_type, TRUST_SAMPLE_RATE, stamp))
    else:
        c.execute(
            "INSERT INTO study_trust (item_type, clean_count, state, sample_rate, updated_at) "
            "VALUES (?,0,'manual',?,?) ON CONFLICT(item_type) DO UPDATE SET clean_count=0, "
            "updated_at=excluded.updated_at",
            (item_type, TRUST_SAMPLE_RATE, stamp))


def review(item_id: str, action: str, by_user: str, *, reason: Optional[str] = None,
           field: Optional[str] = None, after: Any = None) -> dict:
    """approve | fix | reject, logged to study_corrections. `fix` rewrites ONE
    field (answer_json, lesson_text, reveal_json or prompt_json) and leaves the
    item in draft for a second look; `approve` publishes; `reject` retires.
    Trust: approve adds a clean count for the type; fix/reject reset it."""
    if action not in REVIEW_ACTIONS:
        raise ValueError(f"action must be one of {REVIEW_ACTIONS}")
    stamp = _iso(_now_utc())
    with _write() as c:
        row = c.execute("SELECT * FROM study_items WHERE id=?", (item_id,)).fetchone()
        if row is None:
            raise ValueError(f"unknown item {item_id}")
        before = None
        after_s = None
        if action == "approve":
            c.execute("UPDATE study_items SET review_status=?, reviewed_by=?, reviewed_at=? WHERE id=?",
                      (STATUS_APPROVED, by_user, stamp, item_id))
            _bump_trust(c, row["type"], True, stamp)
        elif action == "reject":
            c.execute("UPDATE study_items SET review_status=?, reviewed_by=?, reviewed_at=?, retired_at=? "
                      "WHERE id=?", (STATUS_REJECTED, by_user, stamp, stamp, item_id))
            _bump_trust(c, row["type"], False, stamp)
        else:  # fix
            if field not in ("answer_json", "lesson_text", "reveal_json", "prompt_json"):
                raise ValueError("fix needs field in answer_json|lesson_text|reveal_json|prompt_json")
            before = row[field]
            after_s = _dumps(after) if field.endswith("_json") else (None if after is None else str(after))
            c.execute(f"UPDATE study_items SET {field}=?, version=version+1, review_status=?, "
                      "reviewed_by=?, reviewed_at=?, lesson_origin=CASE WHEN ?='lesson_text' THEN 'session' "
                      "ELSE lesson_origin END WHERE id=?",
                      (after_s, STATUS_DRAFT, by_user, stamp, field, item_id))
            _bump_trust(c, row["type"], False, stamp)
        c.execute(
            "INSERT INTO study_corrections (item_id, item_version, action, field, before_json, after_json, "
            "reason, by_user, at) VALUES (?,?,?,?,?,?,?,?,?)",
            (item_id, int(row["version"] or 1), action, field, before, after_s, reason, by_user, stamp))
    return {"item": get_item_full(item_id), "trust": trust_state(row["type"])}


def approve(item_id: str, by_user: str, reason: Optional[str] = None) -> dict:
    return review(item_id, "approve", by_user, reason=reason)


def fix(item_id: str, by_user: str, field: str, after: Any, reason: Optional[str] = None) -> dict:
    return review(item_id, "fix", by_user, reason=reason, field=field, after=after)


def reject(item_id: str, by_user: str, reason: Optional[str] = None) -> dict:
    return review(item_id, "reject", by_user, reason=reason)


def export_corrections(*, since_id: int = 0, limit: int = 5000) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT * FROM study_corrections WHERE id > ? ORDER BY id LIMIT ?",
                         (int(since_id), int(limit))).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["before_json"] = _loads(d["before_json"], d["before_json"])
        d["after_json"] = _loads(d["after_json"], d["after_json"])
        out.append(d)
    return out


# ── Reminder claim row (one reminder per member per day) ──────────────────────

def claim_reminder(user_id: str, day_et: str) -> bool:
    """True exactly once per (member, day); the scheduler's claim row."""
    with _write() as c:
        try:
            c.execute("INSERT INTO study_reminder_log (user_id, day_et) VALUES (?,?)", (user_id, day_et))
            return True
        except sqlite3.IntegrityError:
            return False


def list_reminder_profiles() -> list[dict]:
    """Members who opted into the reminder, with their chosen time and zone.
    The reminders job reads this once per tick."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT user_id, reminder_time, reminder_tz FROM study_profile "
            "WHERE reminder_on=1 AND reminder_time IS NOT NULL AND reminder_time != ''").fetchall()
    return [dict(r) for r in rows]


def daily_session_finished(user_id: str, day_et: str) -> bool:
    """True when the member's daily set for `day_et` exists AND is finished.
    No session yet counts as unfinished (the reminder should fire)."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT finished_at FROM study_sessions WHERE user_id=? AND kind='daily' AND day_et=? "
            "ORDER BY created_at DESC LIMIT 1", (user_id, day_et)).fetchone()
    return bool(row and row["finished_at"])


# ── Weekly close (the frozen leaderboard) ─────────────────────────────────────

def closed_weeks() -> set[str]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT week_et FROM study_weekly_close").fetchall()
    return {r["week_et"] for r in rows}


def weeks_with_xp(*, before_week: str) -> list[str]:
    """Every ET week (Monday key) that holds XP and ended before `before_week`,
    oldest first — the catch-up's candidate list."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT DISTINCT week_et FROM study_weekly_xp WHERE week_et < ? ORDER BY week_et",
            (before_week,)).fetchall()
    return [r["week_et"] for r in rows]


def close_week(week_et: str, *, top: int = 50, now: Optional[datetime] = None) -> Optional[dict]:
    """Freeze the week's leaderboard into study_weekly_close. Idempotent: a
    week already closed is left exactly as it was and None is returned."""
    board = leaderboard(week_et, top=top)
    stamp = _iso(now or _now_utc())
    with _write() as c:
        try:
            c.execute("INSERT INTO study_weekly_close (week_et, closed_at, rows_json) VALUES (?,?,?)",
                      (week_et, stamp, _dumps(board["rows"])))
        except sqlite3.IntegrityError:
            return None
    return {"week_et": week_et, "closed_at": stamp, "rows": board["rows"]}


def get_week_close(week_et: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM study_weekly_close WHERE week_et=?", (week_et,)).fetchone()
    if not row:
        return None
    return {"week_et": row["week_et"], "closed_at": row["closed_at"],
            "rows": _loads(row["rows_json"], [])}


# ── Reads for the importer's checks ───────────────────────────────────────────

def list_question_rows(skill_ids: Iterable[str]) -> list[dict]:
    """id, skill_id, prompt_json, asof, sym of every non-retired item in these
    skills — the bank the near-duplicate check compares an import against."""
    ids = sorted({s for s in skill_ids if s})
    if not ids:
        return []
    marks = ",".join("?" for _ in ids)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"SELECT id, skill_id, prompt_json, asof, sym FROM study_items WHERE skill_id IN ({marks}) "
            f"AND review_status != ?", (*ids, STATUS_RETIRED)).fetchall()
    return [{"id": r["id"], "skill_id": r["skill_id"], "prompt_json": _loads(r["prompt_json"], {}),
             "asof": r["asof"], "sym": r["sym"]} for r in rows]


# ── Badges / checkpoints (thin; Phase 1 wires the rules) ─────────────────────

def award_badge(user_id: str, badge_id: str) -> bool:
    with _write() as c:
        try:
            c.execute("INSERT INTO study_badges (user_id, badge_id, earned_at) VALUES (?,?,?)",
                      (user_id, badge_id, _iso(_now_utc())))
            return True
        except sqlite3.IntegrityError:
            return False


def list_badges(user_id: str) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT badge_id, earned_at FROM study_badges WHERE user_id=? ORDER BY earned_at",
                         (user_id,)).fetchall()
    return [dict(r) for r in rows]


def record_checkpoint(user_id: str, module: str, passed: bool, score: float,
                      missed_skills: Optional[list] = None) -> int:
    with _write() as c:
        n = c.execute("SELECT COALESCE(MAX(attempt_no),0) AS n FROM study_checkpoints WHERE user_id=? "
                      "AND module=?", (user_id, module)).fetchone()["n"]
        cur = c.execute(
            "INSERT INTO study_checkpoints (user_id, module, attempt_no, passed, score, missed_skills_json, at) "
            "VALUES (?,?,?,?,?,?,?)",
            (user_id, module, int(n) + 1, 1 if passed else 0, float(score), _dumps(missed_skills or []),
             _iso(_now_utc())))
        return int(cur.lastrowid)
