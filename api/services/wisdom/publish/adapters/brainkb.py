"""Brain KB adapter — signed, dated principle and lesson rows with provenance (D18; W1 Part 5).

D18 SEQUENCING, and which half of it this module does
  1. build replacement rows with provenance ............ `build_rows` → `wisdom_kb_rows` (flag OFF is fine:
                                                            a Wisdom-internal staging table, not the KB)
  2. run the Ask-AI grounding eval on old / new / merged . stream S-E (grounding eval) reads the staged rows
  3. diff to the owner's review queue .................. PC-side `tools/wisdom/publish_kb_sync.py --diff-out`
                                                            (the old rows live in the ENGINE KB, not here),
                                                            pushed with `POST .../adapters/review-items`;
                                                            the 36 unsourced voice principles are sourced here
  4. swap behind the flag for the admin cohort ......... `GET /api/internal/wisdom/publish/adapters/kb-export`
                                                            returns rows ONLY when the flag is on, and the sync
                                                            tool refuses `--commit` otherwise
  5. archive superseded rows to an archive table ....... plan only (`--archive-plan-out`); never executed here

ROW RULES (measured against the ENGINE KB, understand-pass consumers map)
- `source='wisdom'` and `source_ref='wisdom:<kind>:<key>'`: the KB's own
  `source_ref` is a free-text citation, so the sync keys on BOTH.
- priority 3, regime_context '': `get_knowledge_context` injects every priority-1
  row into every Morning Wire prompt and priority-2 rows on tag match.
- `knowledge_epoch` always explicit: the live column default is '2024'.
- The date, the signature and the source locator are in the TITLE and the first
  lines of CONTENT, because the KB index embeds only id/category/title/content/
  trader/source and Ask-AI shows the first 350 characters.
- Guests (D14) and non-canonical principles never become KB rows.
"""
from __future__ import annotations

import json
import logging
import pathlib
from typing import Optional

from api.services.wisdom.core import flags, ids, store, timeutil
from api.services.wisdom.publish.adapters import common, kbrow, provenance

log = logging.getLogger(__name__)

CONSUMER = "brainkb"
FLAG_ENV = "WISDOM_BRAINKB_PUBLISH_ENABLED"
PRIORITY = 3
EXPORT_SCHEMA = "wisdom-kb-export-v1"
_ALL_TYPES = ("CALL", "NEGATIVE_CALL", "MENTION", "PRINCIPLE", "LEVEL", "MARKET_SIGNAL")
_CATEGORY = {
    "risk": "RULE", "risk_management": "RULE", "rule": "RULE", "sizing": "SIZING", "position_sizing": "SIZING",
    "psychology": "PSYCHOLOGY", "mindset": "PSYCHOLOGY", "discipline": "PSYCHOLOGY", "setup": "SETUP",
    "entry": "EXECUTION", "exit": "EXECUTION", "execution": "EXECUTION", "market": "REGIME", "regime": "REGIME",
    "screening": "SCREENING", "scanning": "SCREENING", "sector": "SECTOR", "theme": "SECTOR", "macro": "MACRO",
}
VOICE_PRINCIPLES_FILE = (pathlib.Path(__file__).resolve().parents[5]
                         / "api" / "data" / "voice_kb" / "trading_principles.json")
REVIEW_TABS = frozenset({"attribution", "drafts"})
_REVIEW_ITEMS_MAX = 500


def _kb_category(raw: Optional[str]) -> str:
    key = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    return _CATEGORY.get(key, "RULE")


def _epoch(date: Optional[str]) -> str:
    return (date or timeutil.now_et().date().isoformat())[:4]


def _source_phrase(row: Optional[dict]) -> str:
    if not row:
        return "Wisdom principle"
    label = common.STREAM_LABELS.get(row.get("stream") or "", "Source")
    title = common.clip(row.get("source_title"), 80)
    return f'{label} "{title}"' if title else label


def _finish(row: dict) -> dict:
    row.update(priority=PRIORITY, regime_context="", source=kbrow.SOURCE)
    row["content_sha256"] = kbrow.kb_row_sha(row)
    return row


def build_rows(conn) -> list[dict]:
    """Every KB row Wisdom would publish right now. Pure read; deterministic order."""
    team = common.team_author_ids()
    rows: list[dict] = []
    principles = conn.execute(
        f"SELECT principle_key, statement, category, author_id, status, first_seen_at FROM wisdom_principles "
        f"WHERE status IN ('provisional', 'confirmed') AND is_guest = 0 AND (canonical IS NULL OR canonical = 1) "
        f"AND author_id IN ({','.join('?' * len(team))}) ORDER BY principle_key", team).fetchall()
    for p in principles:
        support = common.select_records(
            conn, types=_ALL_TYPES,
            extra_where="r.record_id IN (SELECT record_id FROM wisdom_principle_support WHERE principle_key = ? "
                        "AND relation IN ('states', 'reinforces'))",
            extra_params=(p["principle_key"],), order="r.stated_at_et ASC", limit=1)
        sup = support[0] if support else None
        date = common.record_date(sup) if sup else common.et_date(p["first_seen_at"])
        trader = common.speaker(p["author_id"])
        status = common.status_label(p["status"])
        loc = common.row_locator(sup) if sup else f"wisdom:principle#{p['principle_key']}@statement"
        statement = common.clip(p["statement"], 1200)
        rows.append(_finish({
            "source_ref": f"wisdom:principle:{p['principle_key']}", "kind": "principle",
            "subject_key": p["principle_key"], "category": _kb_category(p["category"]),
            "title": common.clip(f"{trader} — {date or 'undated'} — Principle: {statement}", 160),
            "content": provenance.stamp_text(
                "\n".join((f"UCT said ({status}) — {trader}, {_source_phrase(sup)}, {date or 'undated'}.",
                           f"Source: {loc}", statement)),
                consumer=CONSUMER, subject_ref=f"wisdom_principles:{p['principle_key']}",
                locator=loc, flag_env=FLAG_ENV),
            "tags": ",".join(("wisdom", "principle", (p["category"] or "general").strip().lower(), status)),
            "trader": trader, "knowledge_epoch": _epoch(date), "provisional": int(status != "confirmed"),
        }))
    names = common.vocab_names(conn)
    lessons = common.select_records(
        conn, types=("CALL",),
        extra_where="(r.hindsight = 1 OR r.stated_outcome IN ('profit', 'loss', 'breakeven', 'stopped')) "
                    "AND COALESCE(r.thesis, r.reason, r.trigger_text, '') <> ''",
        order="r.stated_at_et ASC, r.record_id ASC")
    for r in lessons:
        date = common.record_date(r)
        trader = common.speaker(r["author_id"])
        status = common.status_label(r["status"])
        setup = names.get(r["vocab_id"]) or r["setup_name_raw"] or "setup"
        words = common.clip(r["thesis"] or r["reason"] or r["trigger_text"], 1200)
        outcome = r["stated_outcome"] or ("hindsight" if r["hindsight"] else "unstated")
        rows.append(_finish({
            "source_ref": f"wisdom:lesson:{r['record_id']}", "kind": "lesson", "subject_key": r["record_id"],
            "category": "CASE_STUDY",
            "title": common.clip(f"{trader} — {date or 'undated'} — Lesson: {r['ticker'] or ''} {setup}", 160),
            "content": provenance.stamp_text(
                "\n".join((f"UCT said ({status}) — {trader}, {_source_phrase(r)}, {date or 'undated'}.",
                           f"Source: {common.row_locator(r)}",
                           f"Lesson ({setup}, {r['direction'] or 'long'}, stated outcome: {outcome}): {words}")),
                consumer=CONSUMER, subject_ref=f"wisdom_records:{r['record_id']}",
                locator=common.row_locator(r), flag_env=FLAG_ENV),
            "tags": ",".join(("wisdom", "lesson", r["vocab_id"] or "setup", status)),
            "trader": trader, "knowledge_epoch": _epoch(date), "provisional": int(status != "confirmed"),
        }))
    return rows


def stage(conn, rows: list[dict], *, at: Optional[str] = None) -> dict:
    """Upsert into wisdom_kb_rows; a ref Wisdom no longer builds is marked superseded, never deleted."""
    at = at or common.now_iso()
    existing = {r["source_ref"]: dict(r) for r in conn.execute(
        "SELECT source_ref, content_sha256, state FROM wisdom_kb_rows")}
    changes = {"inserted": [], "updated": [], "superseded": [], "unchanged": 0}
    built = set()
    for row in rows:
        ref = row["source_ref"]
        built.add(ref)
        prev = existing.get(ref)
        values = (row["kind"], row["subject_key"], row["category"], row["title"], row["content"], row["tags"],
                  row["trader"], row["knowledge_epoch"], row["priority"], row["regime_context"], row["provisional"],
                  row["content_sha256"])
        if prev is None:
            conn.execute(
                "INSERT INTO wisdom_kb_rows(source_ref, kind, subject_key, category, title, content, tags, trader, "
                "knowledge_epoch, priority, regime_context, provisional, content_sha256, state, built_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)", (ref, *values, at))
            changes["inserted"].append(ref)
        elif prev["content_sha256"] != row["content_sha256"] or prev["state"] != "active":
            conn.execute(
                "UPDATE wisdom_kb_rows SET kind = ?, subject_key = ?, category = ?, title = ?, content = ?, tags = ?, "
                "trader = ?, knowledge_epoch = ?, priority = ?, regime_context = ?, provisional = ?, "
                "content_sha256 = ?, state = 'active', built_at = ?, superseded_at = NULL WHERE source_ref = ?",
                (*values, at, ref))
            changes["updated"].append(ref)
        else:
            changes["unchanged"] += 1
    for ref, prev in existing.items():
        if ref not in built and prev["state"] == "active":
            conn.execute("UPDATE wisdom_kb_rows SET state = 'superseded', superseded_at = ? WHERE source_ref = ?",
                         (at, ref))
            changes["superseded"].append(ref)
    return changes


def export_payload(*, enabled: Optional[bool] = None) -> dict:
    """What the PC-side sync reads. Rows only when the flag is on; a preview count either way."""
    enabled = flags.brainkb_publish_enabled() if enabled is None else bool(enabled)
    with store.read(for_request=True) as conn:
        if not common.table_exists(conn, "wisdom_kb_rows"):
            return {"ok": False, "enabled": enabled, "schema": EXPORT_SCHEMA,
                    "error": "publish_adapters_001 is not applied", "rows": [], "superseded_refs": []}
        active = [dict(r) for r in conn.execute(
            "SELECT source_ref, category, title, content, tags, trader, knowledge_epoch, priority, regime_context, "
            "provisional, content_sha256 FROM wisdom_kb_rows WHERE state = 'active' ORDER BY source_ref")]
        superseded = [r[0] for r in conn.execute(
            "SELECT source_ref FROM wisdom_kb_rows WHERE state = 'superseded' ORDER BY source_ref")]
    for row in active:
        row["source"] = kbrow.SOURCE
    # FAIL CLOSED: a staged row whose content carries no provenance marker never leaves.
    # It would land in the ENGINE KB as a row the shape-based audit could not find again,
    # which is the whole defect §8c.3 closes. Dropped refs are reported, never silent.
    unmarked = [r["source_ref"] for r in active if not provenance.is_marked(r["content"])]
    active = [r for r in active if provenance.is_marked(r["content"])]
    return {
        "ok": True, "schema": EXPORT_SCHEMA, "enabled": enabled, "generated_at": common.now_iso(),
        "flag": FLAG_ENV, "priority": PRIORITY, "preview_count": len(active),
        "marker": provenance.MARKER_VERSION, "unmarked_dropped": unmarked,
        "rows": active if enabled else [], "superseded_refs": superseded if enabled else [],
    }


# ── D18: the 36 unsourced voice principles ───────────────────────────────────

def voice_principles() -> list[dict]:
    try:
        data = json.loads(VOICE_PRINCIPLES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    entries = data.get("entries") if isinstance(data, dict) else None
    return [e for e in (entries or []) if isinstance(e, dict) and e.get("id")]


def voice_principle_candidates(*, limit: int = 3) -> list[dict]:
    """One sourcing proposal per unsourced voice principle. Read-only; the file is never edited.

    A principle with no candidate is proposed as `unsourced` — the owner decides
    retire-or-keep (D18). Nothing here deletes or rewrites the corpus."""
    from api.services.wisdom.publish import retrieval

    out = []
    for entry in voice_principles():
        query = f"{entry.get('title') or ''} {common.clip(entry.get('text'), 240)}"
        hits = retrieval.search(query, limit=limit, for_request=False)
        out.append({
            "voice_kb_id": entry["id"], "category": entry.get("category"), "title": entry.get("title"),
            "candidates": [{"locator": h["locator"], "doc_kind": h["doc_kind"], "speaker": common.speaker(h["author_id"]),
                            "status": h["status"], "stated_at": h["stated_at"], "rank": i + 1}
                           for i, h in enumerate(hits)],
            "proposed_action": "link_to_wisdom_source" if hits else "unsourced_owner_decides",
        })
    return out


def enqueue_review_items(items: list) -> dict:
    """PC-side D18 diffs and attribution plans into the owner's review queue. Idempotent by content."""
    if not isinstance(items, list):
        raise ValueError("items must be a list")
    if len(items) > _REVIEW_ITEMS_MAX:
        raise ValueError(f"at most {_REVIEW_ITEMS_MAX} items per call")
    at = common.now_iso()
    inserted = skipped = 0
    with store.write() as conn:
        for item in items:
            if not isinstance(item, dict) or item.get("tab") not in REVIEW_TABS:
                raise ValueError("each item needs a tab in " + ", ".join(sorted(REVIEW_TABS)))
            subject = common.clip(str(item.get("subject_ref") or ""), 200)
            summary = common.clip(str(item.get("summary") or ""), 500)
            if not subject or not summary:
                raise ValueError("each item needs subject_ref and summary")
            old_json, new_json = common.dumps(item.get("old")), common.dumps(item.get("new"))
            evidence = common.dumps(item.get("evidence") or {})
            if max(len(old_json), len(new_json), len(evidence)) > 20000:
                raise ValueError(f"item {subject} is too large")
            item_id = ids.sha24("review-item", item["tab"], subject, summary, new_json)
            cur = conn.execute(
                "INSERT OR IGNORE INTO wisdom_review_queue(item_id, tab, subject_ref, summary, old_json, new_json, "
                "evidence_json, recommendation, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
                (item_id, item["tab"], subject, summary, old_json, new_json, evidence,
                 common.clip(str(item.get("recommendation") or ""), 500), at))
            inserted += cur.rowcount
            skipped += 1 - cur.rowcount
    return {"inserted": inserted, "already_queued": skipped}


# ── daily step ───────────────────────────────────────────────────────────────

def daily(ctx) -> dict:
    flag_on = flags.brainkb_publish_enabled()
    with store.read() as conn:
        if not common.table_exists(conn, "wisdom_kb_rows"):
            return {"skipped": "publish_adapters_001 is not applied"}
        rows = build_rows(conn)
    sourcing = voice_principle_candidates()
    if getattr(ctx, "dry_run", False):
        return {"dry_run": True, "rows": len(rows), "voice_principles": len(sourcing), "flag_on": flag_on}
    action = "export" if flag_on else "would_publish"
    with store.write() as conn:
        changes = stage(conn, rows)
        for ref in changes["inserted"] + changes["updated"]:
            common.log_publish(conn, CONSUMER, ref, action, FLAG_ENV, flag_on)
        for ref in changes["superseded"]:
            common.log_publish(conn, CONSUMER, ref, "archived" if flag_on else "would_publish", FLAG_ENV, flag_on)
        voice_results = [common.upsert_draft(
            conn, kind="voice_principle_sourcing", subject_ref=f"voice_kb:{s['voice_kb_id']}",
            title=common.clip(f"Source or retire voice principle {s['voice_kb_id']}: {s['title'] or ''}", 200),
            payload=s, citations=[c["locator"] for c in s["candidates"]], queue_tab="attribution",
            summary=f"Voice principle {s['voice_kb_id']} has no provenance; {len(s['candidates'])} candidate source(s).")
            for s in sourcing]
    return {"flag_on": flag_on, "rows": len(rows), "inserted": len(changes["inserted"]),
            "updated": len(changes["updated"]), "superseded": len(changes["superseded"]),
            "unchanged": changes["unchanged"], "voice_principles": len(sourcing),
            "voice_drafts_new": voice_results.count("inserted")}
