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

THE TRADER ARCHIVE AS A SECOND SOURCE (owner rulings 2026-10-15 and 2026-10-16: the archive is a
member surface, it bypasses the R89 floor, and a call's levels publish only once it is more than
`provider.PRICE_AGE_SESSIONS` (20) sessions old). Read only while `WISDOM_ARCHIVE_ENABLED` is on, from
`wisdom_archive_setups` / `wisdom_archive_calls`. A Setup Library name reaches an archive setup
ONLY through the one vocabulary (D9), by one of two keys its `setupCatalog.js` row carries:
  - its vocab_id: every `trader_archive` row with that vocab_id;
  - its `pattern_engine_ids` (set only where the library setup IS that detector, e.g. Slingshot
    = uct_slingshot): the `trader_archive` row that already files that detector.
A library name with neither links to nothing.
  - playbook drafts gain the archive's measured record (n, win rate, edge with the z verdict),
    the traders' teachings by record id, and the calls worth charting;
  - example drafts: the archive playbook's best calls AND its failures, one draft per call,
    labelled as such in `notes`; entry/stop/target only for aged calls.
Every archive read, and the 20-session price gate, is the archive provider's
(`api/services/wisdom/archive/provider.py`); nothing here restates either.
"""
from __future__ import annotations

import pathlib
import re
from typing import Optional

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

ARCHIVE_EXAMPLES_PER_SIDE = 3     # best calls and failures, per linked archive setup
ARCHIVE_TEACHINGS = 8
ARCHIVE_LIST = "trader_archive"


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


# ── the trader archive ───────────────────────────────────────────────────────

def archive_links() -> dict:
    """Setup Library name -> archive setup ids, through the one vocabulary (D9). Never a typed list.

    Two keys, both read from the vocabulary file: a library row's vocab_id reaches every archive row
    with that vocab_id (lowest mismatch first); its `pattern_engine_ids` reach the archive row that
    already files each of those detectors."""
    from api.services.wisdom.core import vocab

    maps = vocab.load_vocabulary().get("maps") or {}
    by_vocab: dict = {}
    by_detector: dict = {}
    for row in (maps.get(ARCHIVE_LIST) or {}).get("rows") or []:
        if row.get("vocab_id"):
            by_vocab.setdefault(row["vocab_id"], []).append((row.get("mismatch") or 0, row["external_name"]))
        for pid in row.get("pattern_engine_ids") or []:
            by_detector[pid] = row["external_name"]
    library = set(catalog_names())
    out: dict = {}
    for row in (maps.get(CATALOG_LIST) or {}).get("rows") or []:
        name, vid = row.get("external_name"), row.get("vocab_id")
        if name not in library:
            continue
        ids = [sid for _, sid in sorted(by_vocab.get(vid) or [])] if vid else []
        ids += [by_detector[pid] for pid in row.get("pattern_engine_ids") or [] if pid in by_detector]
        ids = list(dict.fromkeys(ids))
        if ids:
            out[name] = ids
    return out


def _archive_read(conn) -> Optional[dict]:
    """{setup_id: playbook} for every linked archive setup, or None while the archive is off or absent.

    The read is the archive provider's (`provider.setups`); this only chooses which setups."""
    from api.services.wisdom.archive import provider

    if not provider.enabled() or not provider.has_setups(conn):
        return None
    wanted = sorted({sid for ids in archive_links().values() for sid in ids})
    if not wanted:
        return {}
    return provider.setups(conn, wanted)


def _archive_levels(conn, picked: list) -> dict:
    """call_id -> {aged, entry, stop, target} for the picked (setup, playbook, side, call) entries.

    The 20-session gate is the archive provider's, the one authority: `provider.levels` returns
    prices only for aged calls, and `provider.is_aged` decides the `aged` flag."""
    from api.services.wisdom.archive import provider

    call_ids = sorted({e["call_id"] for _, _, _, e in picked})
    if not call_ids:
        return {}
    gated = provider.levels(conn, call_ids)
    out = {}
    for _, _, _, e in picked:
        aged = provider.is_aged(e.get("posted"))
        prices = dict(gated.get(e["call_id"]) or []) if aged else {}
        out[e["call_id"]] = {"aged": aged, "entry": prices.get("entry"),
                             "stop": prices.get("stop"), "target": prices.get("target")}
    return out


def _pct(v) -> str:
    try:
        x = float(v) * 100
    except (TypeError, ValueError):
        return "n/a"
    return f"{'+' if x > 0 else ''}{x:.1f}%"


def _verdict_line(pb: dict) -> str:
    """One measured line: n, win rate, edge vs the same stock, edge R and its verdict, best context."""
    from api.services.wisdom.archive import askai

    st = ((pb.get("stats") or {}).get("all")) or {}
    n, z, edge, win = int(st.get("n_scored") or 0), st.get("edgeR_z"), st.get("mean_edgeR"), st.get("win20")
    proven = z is not None and abs(z) >= askai.EDGE_Z and n >= askai.MIN_CONTEXT_N
    bits = [f"{pb.get('name') or pb['setup_id']}: {n} scored calls",
            f"win 20d {round(win * 100)}%" if win is not None else None,
            f"median vs same stock {_pct(st.get('med_edge20'))}",
            f"edge R {edge:+.2f}" if edge is not None else None,
            ("measured edge" if proven else "edge not proven") + (f" (z {z:.1f})" if z is not None else "")]
    best = None
    for group, rows in (pb.get("context") or {}).items():
        for value, cst in (rows or {}).items():
            if (cst or {}).get("n_scored", 0) >= askai.MIN_CONTEXT_N and cst.get("mean_edgeR") is not None:
                if best is None or cst["mean_edgeR"] > best[2]:
                    best = (group.replace("_", " "), value, cst["mean_edgeR"], int(cst["n_scored"]))
    if best:
        bits.append(f"strongest context {best[0]} = {best[1]} (edge R {best[2]:+.2f}, n {best[3]})")
    return "; ".join(b for b in bits if b)


def _archive_playbook_sections(setup: str, links: dict, archive: dict) -> tuple[list, list]:
    """(sections, citations) the archive adds to one library setup's playbook draft."""
    from api.services.wisdom.publish.adapters import common

    measured, words, chart, cites = [], [], [], []
    for sid in links.get(setup, []):
        pb = archive.get(sid)
        if not pb:
            continue
        loc = f"wisdom_archive_setups:{sid}"
        measured.append({"text": _verdict_line(pb), "locator": loc, "date": None, "status": "measured"})
        cites.append(loc)
        for t in (pb.get("teachings") or [])[:ARCHIVE_TEACHINGS]:
            if t.get("note"):
                words.append({"text": common.clip(t["note"], 400), "locator": t["record_id"],
                              "date": t.get("date"), "status": common.speaker(t.get("author_id"))})
                cites.append(t["record_id"])
        for side, rows in (("best", pb.get("winners") or []), ("failure", pb.get("failures") or [])):
            for e in rows[:ARCHIVE_EXAMPLES_PER_SIDE]:
                chart.append({"text": f"{side}: {e.get('ticker')} {str(e.get('posted') or '')[:10]} "
                                      f"({common.speaker(e.get('author_id'))}) r20 {_pct(e.get('r20'))}",
                              "locator": e["call_id"], "date": str(e.get("posted") or "")[:10] or None,
                              "status": side})
    sections = [{"label": "Measured record (trader archive)", "items": measured},
                {"label": "In the traders' words (trader archive)", "items": words},
                {"label": "Calls worth charting (trader archive)", "items": chart}]
    return [x for x in sections if x["items"]], cites


def build_archive_example_drafts(conn) -> list[dict]:
    """One draft per archive best call and failure of every linked library setup."""
    from api.services.wisdom.publish.adapters import common

    archive = _archive_read(conn)
    if not archive:
        return []
    links = archive_links()
    picked = []
    for setup in catalog_names():
        for sid in links.get(setup, []):
            pb = archive.get(sid)
            if not pb:
                continue
            for side, rows in (("best", pb.get("winners") or []), ("failure", pb.get("failures") or [])):
                picked += [(setup, pb, side, e) for e in rows[:ARCHIVE_EXAMPLES_PER_SIDE] if e.get("call_id")]
    levels = _archive_levels(conn, picked)
    drafts, seen = [], set()
    for setup, pb, side, e in picked:
        posted = str(e.get("posted") or "")[:10]
        if (setup, e["call_id"]) in seen or not e.get("ticker") or len(posted) != 10:
            continue
        seen.add((setup, e["call_id"]))
        lv = levels.get(e["call_id"], {})
        label = "Best call" if side == "best" else "FAILURE"
        sim = e.get("sim_R")
        outcome = f"r20 {_pct(e.get('r20'))}" + (f", trade {sim:+.1f}R" if isinstance(sim, (int, float)) else "")
        notes = (f"{label} of the archive's {pb.get('name') or pb['setup_id']} playbook. "
                 f"{e.get('evidence') or ''} — {common.speaker(e.get('author_id'))}, trader archive {posted} "
                 f"({e['record_id']}). Measured after the fact: {outcome}.")
        drafts.append({
            "subject_ref": f"wisdom_archive_calls:{e['call_id']}:{setup}",
            "title": common.clip(f"Model Book example — {setup} — {e['ticker']} {posted} ({label.lower()})", 200),
            "payload": {
                "setup_name": setup, "symbol": common.normalize_ticker(e["ticker"]), "year": int(posted[:4]),
                "label_date": posted, "timeframe": "D", "entry_price": lv.get("entry"),
                "stop_price": lv.get("stop"), "target_price": lv.get("target"), "grade": None,
                "notes": common.clip(notes, 1000), "record_id": e["record_id"], "call_id": e["call_id"],
                "archive_setup": pb["setup_id"], "archive_side": side,
                "levels_withheld": not lv.get("aged", False), "status": "measured",
            },
            "citations": [e["record_id"], e["call_id"]],
            "provisional": True,
        })
    return drafts


def build_playbook_drafts(conn) -> list[dict]:
    from api.services.wisdom.publish.adapters import common

    vocab_for = {name: vid for vid, name in common.vocab_map(conn, CATALOG_LIST).items()}
    statements = {r["principle_key"]: r["statement"] for r in conn.execute(
        "SELECT principle_key, statement FROM wisdom_principles WHERE status IN ('provisional', 'confirmed') "
        "AND is_guest = 0 AND (canonical IS NULL OR canonical = 1)")}
    archive = _archive_read(conn)
    links = archive_links() if archive else {}
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
        extra: list = []
        if archive:
            extra, more = _archive_playbook_sections(setup, links, archive)
            cites += more
        total = sum(len(v) for v in sections.values()) + sum(len(x["items"]) for x in extra)
        drafts.append({
            "subject_ref": f"setup_playbook:{setup}",
            "title": common.clip(f"Setup playbook draft — {setup}", 200),
            "payload": {
                "setup_name": setup, "vocab_id": vid,
                "sections": [{"label": k, "items": v} for k, v in sections.items()] + extra,
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
        archive_examples = build_archive_example_drafts(conn)
        playbooks = build_playbook_drafts(conn)
    out = {"flag_on": flag_on, "example_drafts": len(examples) + len(archive_examples),
           "archive_example_drafts": len(archive_examples), "playbook_drafts": len(playbooks)}
    examples = examples + archive_examples
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
