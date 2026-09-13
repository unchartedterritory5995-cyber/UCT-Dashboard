"""The setup vocabulary: the ONE setup-name authority (D9; W1 §3; CONTRACTS §6.2).

SOURCE OF TRUTH: docs/wisdom/vocabulary/setup-vocabulary-v1.json. seed() copies it into
wisdom_vocab and wisdom_vocab_maps, keyed by the file's content hash, so a changed file
re-seeds once and an unchanged one never writes. The six existing setup lists, the
pattern-engine ids and the ENGINE strings MAP to it; nothing here adds a seventh list.

WHAT SEEDING NEVER DOES: overwrite an owner decision. A vocabulary row whose approved_by is
not seed-owned (the owner approved, retired or vetoed it) keeps its status; only its
descriptive fields refresh. No row is ever deleted (W1 §11.5: additive only).

PUBLIC FUNCTIONS OTHER STREAMS CALL
  lookup(name) -> vocab_id | None       names and unambiguous aliases, case/space-insensitive
  list_for_prompt() -> list[str]        every non-retired name, setups first
  record_candidate(raw_name, record_id, author_id, locator) -> dict
      A name the vocabulary does not know is queued (W1 §3.6) with its defining locator and
      count, and put in the owner's review queue. At AUTOPROMOTE_MIN_INDEPENDENT_TEAM_USES
      independent uses by team authors it is promoted, PROVISIONALLY (W1 §0.3), only while
      flags.vocab_autopromote_enabled() is on; otherwise it waits and says why.
      "Independent" means distinct sources: two records from one session are one use.
"""
from __future__ import annotations

import functools
import hashlib
import json
import logging
import pathlib
import re
import sqlite3
import threading
import time
from typing import Iterable, Optional

from api.services.wisdom.core import authors, flags, ids, store, timeutil

log = logging.getLogger(__name__)

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
VOCAB_FILE = REPO_ROOT / "docs" / "wisdom" / "vocabulary" / "setup-vocabulary-v1.json"
SEED_NAME = "setup_vocabulary"
SEED_APPROVER = "seed:setup-vocabulary-v1"
AUTO_APPROVER = "auto:vocab_autopromote"
AUTOPROMOTE_MIN_INDEPENDENT_TEAM_USES = 3
TEAM_ROLES = frozenset({"owner", "team"})
KIND_ORDER = ("setup", "level", "market_signal")

_LOCK = threading.Lock()
_INDEX_CACHE: dict = {}
_SEEDED: dict = {}
_INDEX_TTL_S = 60.0


def normalize_name(name) -> str:
    return re.sub(r"\s+", " ", str(name or "")).strip().casefold()


@functools.lru_cache(maxsize=1)
def _raw() -> tuple[str, str]:
    text = VOCAB_FILE.read_text(encoding="utf-8")
    return text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_vocabulary() -> dict:
    return json.loads(_raw()[0])


def clear_cache() -> None:
    with _LOCK:
        _INDEX_CACHE.clear()
        _SEEDED.clear()
    _raw.cache_clear()


def team_author_ids() -> frozenset:
    return frozenset(a["author_id"] for a in authors.authors() if a.get("role") in TEAM_ROLES)


# ── seeding ──────────────────────────────────────────────────────────────────

def seed(db_path: Optional[str] = None, *, force: bool = False) -> dict:
    data = load_vocabulary()
    sha = _raw()[1]
    now = timeutil.iso_et(timeutil.now_et())
    counts: dict = {"seeded": False, "inserted": 0, "updated": 0, "owner_kept": 0, "conflicts": [], "map_rows": 0}
    with store.write(db_path) as conn:
        state = conn.execute("SELECT content_sha256 FROM wisdom_seed_state WHERE seed_name = ?", (SEED_NAME,)).fetchone()
        if state is not None and state["content_sha256"] == sha and not force:
            counts["reason"] = "wisdom.db already holds this vocabulary file"
            return counts
        for entry in data["entries"]:
            approved = entry["status"] == "approved"
            described = (entry.get("definition"), entry.get("definition_locator"),
                         json.dumps(entry.get("aliases", []), ensure_ascii=False), int(entry.get("evidence_count", 0)),
                         data["version"])
            existing = conn.execute("SELECT approved_by FROM wisdom_vocab WHERE vocab_id = ?",
                                    (entry["vocab_id"],)).fetchone()
            try:
                if existing is None:
                    conn.execute(
                        "INSERT INTO wisdom_vocab(vocab_id, name, kind, status, coined_by, definition, definition_locator, "
                        "aliases_json, evidence_count, version, approved_by, approved_at, provisional) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                        (entry["vocab_id"], entry["name"], entry["kind"], entry["status"], entry.get("coined_by"),
                         *described, SEED_APPROVER if approved else None, now if approved else None))
                    counts["inserted"] += 1
                elif existing["approved_by"] is None or str(existing["approved_by"]).startswith("seed:"):
                    conn.execute(
                        "UPDATE wisdom_vocab SET name = ?, kind = ?, status = ?, coined_by = ?, definition = ?, "
                        "definition_locator = ?, aliases_json = ?, evidence_count = ?, version = ?, approved_by = ?, "
                        "approved_at = ? WHERE vocab_id = ?",
                        (entry["name"], entry["kind"], entry["status"], entry.get("coined_by"), *described,
                         SEED_APPROVER if approved else None, now if approved else None, entry["vocab_id"]))
                    counts["updated"] += 1
                else:
                    conn.execute(
                        "UPDATE wisdom_vocab SET definition = ?, definition_locator = ?, aliases_json = ?, "
                        "evidence_count = ?, version = ? WHERE vocab_id = ?", (*described, entry["vocab_id"]))
                    counts["owner_kept"] += 1
            except sqlite3.IntegrityError as exc:
                counts["conflicts"].append({"vocab_id": entry["vocab_id"], "name": entry["name"], "error": str(exc)})
        for list_name, spec in data["maps"].items():
            for row in spec["rows"]:
                conn.execute(
                    "INSERT INTO wisdom_vocab_maps(list_name, external_name, vocab_id, mismatch, note) "
                    "VALUES (?, ?, ?, ?, ?) ON CONFLICT(list_name, external_name) DO UPDATE SET "
                    "vocab_id = excluded.vocab_id, mismatch = excluded.mismatch, note = excluded.note",
                    (list_name, row["external_name"], row["vocab_id"], int(row["mismatch"]), row.get("note")))
                counts["map_rows"] += 1
        counts["seeded"] = True
        conn.execute(
            "INSERT INTO wisdom_seed_state(seed_name, version, content_sha256, counts_json, seeded_at) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(seed_name) DO UPDATE SET version = excluded.version, "
            "content_sha256 = excluded.content_sha256, counts_json = excluded.counts_json, seeded_at = excluded.seeded_at",
            (SEED_NAME, data["version"], sha, json.dumps(counts, ensure_ascii=False), now))
    path = db_path or store.db_path()
    with _LOCK:
        _INDEX_CACHE.pop(path, None)
        _SEEDED[path] = sha
    if counts["conflicts"]:
        log.error("[wisdom-vocab] %d vocabulary row(s) not seeded: %s", len(counts["conflicts"]), counts["conflicts"])
    return counts


def ensure_seeded(db_path: Optional[str] = None) -> None:
    path = db_path or store.db_path()
    if _SEEDED.get(path) == _raw()[1]:
        return
    seed(path)


# ── reading ──────────────────────────────────────────────────────────────────

def _build_index(rows: Iterable[dict]) -> dict:
    names: dict = {}
    alias_owners: dict = {}
    for row in rows:
        names[normalize_name(row["name"])] = row["vocab_id"]
        for alias in row["aliases"]:
            alias_owners.setdefault(normalize_name(alias), set()).add(row["vocab_id"])
    index = dict(names)
    for key, owners in alias_owners.items():
        if key and key not in index:
            index[key] = next(iter(owners)) if len(owners) == 1 else None
    return index


def _json_rows() -> list[dict]:
    return [{"vocab_id": e["vocab_id"], "name": e["name"], "kind": e["kind"], "status": e["status"],
             "aliases": e.get("aliases", [])} for e in load_vocabulary()["entries"]]


def _db_rows(path: str) -> list[dict]:
    ensure_seeded(path)
    with store.read(path) as conn:
        return [{"vocab_id": r["vocab_id"], "name": r["name"], "kind": r["kind"], "status": r["status"],
                 "aliases": json.loads(r["aliases_json"] or "[]")}
                for r in conn.execute(
                    "SELECT vocab_id, name, kind, status, aliases_json FROM wisdom_vocab WHERE status != 'retired'")]


def _rows(db_path: Optional[str]) -> tuple[str, list[dict]]:
    path = db_path or store.db_path()
    try:
        return path, _db_rows(path)
    except sqlite3.Error as exc:
        log.warning("[wisdom-vocab] wisdom.db vocabulary unreadable (%s); reading the committed file",
                    type(exc).__name__)
        return path, [r for r in _json_rows() if r["status"] != "retired"]


def lookup(name, *, db_path: Optional[str] = None) -> Optional[str]:
    key = normalize_name(name)
    if not key:
        return None
    path = db_path or store.db_path()
    now = time.monotonic()
    with _LOCK:
        hit = _INDEX_CACHE.get(path)
    if hit is None or now - hit[0] >= _INDEX_TTL_S:
        _, rows = _rows(path)
        hit = (now, _build_index(rows))
        with _LOCK:
            _INDEX_CACHE[path] = hit
    return hit[1].get(key)


def list_for_prompt(*, kinds: Optional[Iterable[str]] = None, include_candidates: bool = True,
                    db_path: Optional[str] = None) -> list[str]:
    _, rows = _rows(db_path)
    wanted = set(kinds) if kinds else None
    chosen = [r for r in rows if (wanted is None or r["kind"] in wanted)
              and (include_candidates or r["status"] == "approved")]
    chosen.sort(key=lambda r: (KIND_ORDER.index(r["kind"]) if r["kind"] in KIND_ORDER else len(KIND_ORDER),
                               r["name"].casefold()))
    return [r["name"] for r in chosen]


def map_lookup(list_name: str, external_name: str, *, db_path: Optional[str] = None) -> Optional[dict]:
    """The wisdom_vocab_maps row for one external list name, or None when the list has no row."""
    path = db_path or store.db_path()
    ensure_seeded(path)
    with store.read(path) as conn:
        row = conn.execute("SELECT list_name, external_name, vocab_id, mismatch, note FROM wisdom_vocab_maps "
                           "WHERE list_name = ? AND external_name = ?", (list_name, external_name)).fetchone()
    return dict(row) if row else None


# ── candidates (W1 §3.6) ─────────────────────────────────────────────────────

def _locator_source(locator: Optional[str]) -> Optional[str]:
    text = str(locator or "").strip()
    if not text:
        return None
    return re.split(r"[@#]", text, maxsplit=1)[0].strip() or None


def _upsert_review_item(conn, kind: str, name: str, *, summary: str, evidence: dict, recommendation: str,
                        now: str) -> str:
    item_id = ids.sha24("wisdom_vocab", kind, normalize_name(name))
    conn.execute(
        "INSERT INTO wisdom_review_queue(item_id, tab, subject_ref, summary, evidence_json, recommendation, status, "
        "created_at) VALUES (?, 'vocabulary', ?, ?, ?, ?, 'open', ?) ON CONFLICT(item_id) DO UPDATE SET "
        "summary = excluded.summary, evidence_json = excluded.evidence_json, recommendation = excluded.recommendation "
        "WHERE wisdom_review_queue.status = 'open'",
        (item_id, f"{kind}:{name}", summary, json.dumps(evidence, ensure_ascii=False), recommendation, now))
    return item_id


def record_candidate(raw_name, record_id: str, author_id: Optional[str], locator: Optional[str], *,
                     source_id: Optional[str] = None, db_path: Optional[str] = None) -> dict:
    name = re.sub(r"\s+", " ", str(raw_name or "")).strip()
    if not name:
        return {"status": "ignored", "reason": "empty name"}
    if not record_id:
        raise ValueError("record_id is required to count a candidate use")
    known = lookup(name, db_path=db_path)
    if known:
        return {"status": "known", "raw_name": name, "vocab_id": known}
    team = author_id in team_author_ids()
    now = timeutil.iso_et(timeutil.now_et())
    promoted = False
    with store.write(db_path) as conn:
        source_row = conn.execute("SELECT source_id FROM wisdom_records WHERE record_id = ?", (record_id,)).fetchone()
        independence_key = source_id or (source_row["source_id"] if source_row else None) \
            or _locator_source(locator) or record_id
        conn.execute(
            "INSERT OR IGNORE INTO wisdom_vocab_candidate_uses(raw_name, record_id, author_id, independence_key, locator, "
            "team_author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, record_id, author_id, independence_key, locator, int(team), now))
        conn.execute(
            "INSERT INTO wisdom_vocab_candidates(raw_name, first_record_id, independent_uses, team_author_uses, "
            "defining_locator, status) VALUES (?, ?, 0, 0, ?, 'queued') ON CONFLICT(raw_name) DO NOTHING",
            (name, record_id, locator))
        uses = conn.execute("SELECT COUNT(DISTINCT independence_key) FROM wisdom_vocab_candidate_uses WHERE raw_name = ?",
                            (name,)).fetchone()[0]
        team_uses = conn.execute("SELECT COUNT(DISTINCT independence_key) FROM wisdom_vocab_candidate_uses "
                                 "WHERE raw_name = ? AND team_author = 1", (name,)).fetchone()[0]
        conn.execute("UPDATE wisdom_vocab_candidates SET independent_uses = ?, team_author_uses = ? WHERE raw_name = ?",
                     (uses, team_uses, name))
        candidate = conn.execute("SELECT raw_name, first_record_id, defining_locator, status FROM wisdom_vocab_candidates "
                                 "WHERE raw_name = ?", (name,)).fetchone()
        canonical = candidate["raw_name"]
        evidence = {"defining_locator": candidate["defining_locator"], "first_record_id": candidate["first_record_id"],
                    "independent_uses": uses, "team_author_uses": team_uses,
                    "autopromote_threshold": AUTOPROMOTE_MIN_INDEPENDENT_TEAM_USES}
        _upsert_review_item(
            conn, "vocab_candidate", canonical,
            summary=(f"New setup-name candidate '{canonical}': {uses} independent use(s), "
                     f"{team_uses} by team authors"),
            evidence=evidence,
            recommendation=("approve if it names a repeatable setup the authors use; veto otherwise "
                            f"(auto-promotes provisionally at {AUTOPROMOTE_MIN_INDEPENDENT_TEAM_USES} independent "
                            "team uses when WISDOM_VOCAB_AUTOPROMOTE_ENABLED is on)"),
            now=now)
        result = {"status": candidate["status"], "raw_name": canonical, "independent_uses": uses,
                  "team_author_uses": team_uses, "vocab_id": None}
        if candidate["status"] == "queued" and team_uses >= AUTOPROMOTE_MIN_INDEPENDENT_TEAM_USES:
            if flags.vocab_autopromote_enabled():
                existing = conn.execute("SELECT vocab_id FROM wisdom_vocab WHERE name = ? COLLATE NOCASE",
                                        (canonical,)).fetchone()
                vocab_id = existing["vocab_id"] if existing else "cand_" + ids.sha24("vocab_candidate",
                                                                                      normalize_name(canonical))
                if existing is None:
                    conn.execute(
                        "INSERT INTO wisdom_vocab(vocab_id, name, kind, status, coined_by, definition, definition_locator, "
                        "aliases_json, evidence_count, version, approved_by, approved_at, provisional) "
                        "VALUES (?, ?, 'setup', 'approved', NULL, NULL, ?, '[]', ?, 'auto', ?, ?, 1)",
                        (vocab_id, canonical, candidate["defining_locator"], uses, AUTO_APPROVER, now))
                conn.execute("UPDATE wisdom_vocab_candidates SET status = 'promoted' WHERE raw_name = ?", (canonical,))
                _upsert_review_item(
                    conn, "vocab_promotion", canonical,
                    summary=(f"Auto-promoted '{canonical}' into the vocabulary, PROVISIONAL: {uses} independent use(s), "
                             f"{team_uses} by team authors. Kind assumed 'setup'."),
                    evidence={**evidence, "vocab_id": vocab_id},
                    recommendation="keep if it names a repeatable setup; veto to retire it",
                    now=now)
                result.update(status="promoted", vocab_id=vocab_id, provisional=True)
                promoted = True
            else:
                result["autopromote"] = ("threshold met; WISDOM_VOCAB_AUTOPROMOTE_ENABLED is off, "
                                         "so it waits for the owner")
    if promoted:
        with _LOCK:
            _INDEX_CACHE.pop(db_path or store.db_path(), None)
    return result
