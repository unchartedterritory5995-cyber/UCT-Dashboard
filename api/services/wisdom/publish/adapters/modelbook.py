"""Model Book example drafts + the missing setup playbooks, from the owner's own words (D19).

Flag `WISDOM_MODELBOOK_DRAFTS_ENABLED`. Off: the daily step logs `would_publish` previews and
writes no draft. On: drafts land in `wisdom_drafts` and the owner's review queue. NOTHING
auto-publishes: `GET /api/modelbook/setup-examples` is require_paid with no draft column,
so a row in modelbook.db is live for paid members the moment it exists. The only path into
it is the owner-only approval route (adapters/drafts.py), and only with the flag on.

EXAMPLES — one per closed or hindsight TSDR CALL whose setup maps into the Setup Library's
display names (`wisdom_vocab_maps` list `setupCatalog.js`, W1 §3.2). Prices are stated
prices of CLOSED trades only, read by `_closed_levels`, the only function here that reads
a level column; a record with a private-store row publishes no prices at all.

PLAYBOOKS — the setups in `app/src/pages/modelbook/setupCatalog.js` with no entry in
`setupPlaybooks.js`, derived from those two files every run (never a typed list). Each
draft gathers the owner's statements about that setup, every item cited. A setup with no
source material yet still gets a draft marked `awaiting_source_material`, so the queue
shows the whole gap. A playbook is frontend code: approving one records the decision and
hands it to the Model Book owner; nothing writes that file.
"""
from __future__ import annotations

import pathlib
import re

from api.services.wisdom.core import flags

CONSUMER = "modelbook"
FLAG_ENV = "WISDOM_MODELBOOK_DRAFTS_ENABLED"
KIND_EXAMPLE = "modelbook_example"
KIND_PLAYBOOK = "modelbook_playbook"
CATALOG_LIST = "setupCatalog.js"
OWNER_AUTHOR = "tsdr"
_MODELBOOK_DIR = pathlib.Path(__file__).resolve().parents[5] / "app" / "src" / "pages" / "modelbook"
CATALOG_FILE = _MODELBOOK_DIR / "setupCatalog.js"
PLAYBOOKS_FILE = _MODELBOOK_DIR / "setupPlaybooks.js"
_CATALOG_NAME_RE = re.compile(r"^\s*name:\s*'((?:[^'\\]|\\.)+)'", re.M)
_PLAYBOOK_KEY_RE = re.compile(r"^ {2}'((?:[^'\\]|\\.)+)'\s*:\s*\{", re.M)
_CLOSED_WHERE = ("(r.hindsight = 1 OR r.stance IN ('exited', 'stopped_out', 'hindsight') "
                 "OR r.stated_outcome IN ('profit', 'loss', 'breakeven', 'stopped'))")


def _js_names(path: pathlib.Path, pattern: re.Pattern) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    return list(dict.fromkeys(m.replace("\\'", "'") for m in pattern.findall(text)))


def catalog_names() -> list[str]:
    return _js_names(CATALOG_FILE, _CATALOG_NAME_RE)


def authored_playbooks() -> list[str]:
    return _js_names(PLAYBOOKS_FILE, _PLAYBOOK_KEY_RE)


def missing_playbooks() -> list[str]:
    authored = set(authored_playbooks())
    return [name for name in catalog_names() if name not in authored]


def _closed_levels(conn, record_ids: list[str]) -> dict:
    """Stated entry/stop/first target of CLOSED records without a private-store row. The only level read."""
    if not record_ids:
        return {}
    from api.services.wisdom.publish.adapters import common

    out = {}
    for r in conn.execute(
            f"SELECT record_id, entry, stop, targets_json FROM wisdom_records r "
            f"WHERE r.record_id IN ({','.join('?' * len(record_ids))}) AND {_CLOSED_WHERE} "
            f"AND COALESCE(r.stated_outcome, '') <> 'still_holding' AND r.has_private = 0", record_ids):
        target = next((t.get("price") for t in common.parse_json(r["targets_json"], [])
                       if isinstance(t, dict) and t.get("price") is not None), None)
        out[r["record_id"]] = {"entry": r["entry"], "stop": r["stop"], "target": target}
    return out


def build_example_drafts(conn) -> list[dict]:
    from api.services.wisdom.publish.adapters import common

    display = common.vocab_map(conn, CATALOG_LIST)
    library = set(catalog_names())
    records = common.select_records(conn, types=("CALL",), authors=(OWNER_AUTHOR,), extra_where=_CLOSED_WHERE,
                                    order="r.stated_at_et ASC, r.record_id ASC")
    levels = _closed_levels(conn, [r["record_id"] for r in records])
    drafts = []
    for r in records:
        setup = display.get(r["vocab_id"])
        date = common.record_date(r)
        if not setup or setup not in library or not r["ticker"] or not date:
            continue
        lv = levels.get(r["record_id"], {})
        words = r["thesis"] or r["trigger_text"] or r["reason"] or ""
        loc = common.row_locator(r)
        label = common.STREAM_LABELS.get(r["stream"] or "", "Source")
        status = common.status_label(r["status"])
        drafts.append({
            "subject_ref": f"wisdom_records:{r['record_id']}",
            "title": common.clip(f"Model Book example — {setup} — {r['ticker']} {date}", 200),
            "payload": {
                "setup_name": setup, "symbol": common.normalize_ticker(r["ticker"]), "year": int(date[:4]),
                "label_date": date, "timeframe": "D", "entry_price": lv.get("entry"), "stop_price": lv.get("stop"),
                "target_price": lv.get("target"), "grade": None,
                "notes": common.clip(f"{words} — {common.speaker(r['author_id'])}, {label} {date} ({loc})", 1000),
                "record_id": r["record_id"], "status": status,
            },
            "citations": [loc],
            "provisional": status != "confirmed",
        })
    return drafts


def build_playbook_drafts(conn) -> list[dict]:
    from api.services.wisdom.publish.adapters import common

    vocab_for = {name: vid for vid, name in common.vocab_map(conn, CATALOG_LIST).items()}
    statements = {r["principle_key"]: r["statement"] for r in conn.execute(
        "SELECT principle_key, statement FROM wisdom_principles WHERE status IN ('provisional', 'confirmed') "
        "AND is_guest = 0 AND (canonical IS NULL OR canonical = 1)")}
    drafts = []
    for setup in missing_playbooks():
        vid = vocab_for.get(setup)
        sections = {"What it is, in his words": [], "Triggers he acts on": [], "When he passes": []}
        cites: list = []
        if vid:
            for r in common.select_records(conn, types=("PRINCIPLE", "CALL", "NEGATIVE_CALL"), authors=(OWNER_AUTHOR,),
                                           extra_where="r.vocab_id = ?", extra_params=(vid,),
                                           order="r.stated_at_et ASC", limit=200):
                if r["record_type"] == "PRINCIPLE":
                    section, words = "What it is, in his words", statements.get(r["principle_key"])
                elif r["record_type"] == "CALL":
                    section, words = "Triggers he acts on", r["trigger_text"] or r["thesis"]
                else:
                    section, words = "When he passes", r["reason"]
                if not words:
                    continue
                loc = common.row_locator(r)
                sections[section].append({"text": common.clip(words, 400), "locator": loc,
                                          "date": common.record_date(r), "status": common.status_label(r["status"])})
                cites.append(loc)
        total = sum(len(v) for v in sections.values())
        drafts.append({
            "subject_ref": f"setup_playbook:{setup}",
            "title": common.clip(f"Setup playbook draft — {setup}", 200),
            "payload": {
                "setup_name": setup, "vocab_id": vid,
                "sections": [{"label": k, "items": v} for k, v in sections.items()],
                "state": "draft" if total else "awaiting_source_material",
                "target": "app/src/pages/modelbook/setupPlaybooks.js — code; the Model Book owner applies an approved draft",
            },
            "citations": cites,
            "provisional": True,
        })
    return drafts


def daily(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    flag_on = flags.modelbook_drafts_enabled()
    with store.read() as conn:
        examples = build_example_drafts(conn)
        playbooks = build_playbook_drafts(conn)
    out = {"flag_on": flag_on, "example_drafts": len(examples), "playbook_drafts": len(playbooks)}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    results: list = []
    with store.write() as conn:
        if flag_on:
            for kind, drafts in ((KIND_EXAMPLE, examples), (KIND_PLAYBOOK, playbooks)):
                results += [common.upsert_draft(conn, kind=kind, subject_ref=d["subject_ref"], title=d["title"],
                                                payload=d["payload"], citations=d["citations"],
                                                provisional=d["provisional"]) for d in drafts]
        common.log_publish(conn, CONSUMER, f"summary:examples={len(examples)}:playbooks={len(playbooks)}",
                           "export" if flag_on else "would_publish", FLAG_ENV, flag_on)
    return {**out, "inserted": results.count("inserted"), "updated": results.count("updated")}
