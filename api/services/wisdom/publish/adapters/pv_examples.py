"""Pattern Vision examples adapter — team charts as labelled exemplar DRAFTS (D13; W1 Part 5).

⛔ DRAFTS ONLY. The Pattern Intelligence Lab is paused by owner ruling (2026-09-07), and
any row in `pattern_vision.db` `pattern_exemplars` changes the live judge's few-shot
immediately — a recognition change under that hold. So this module never imports
`api.services.pattern_vision`, never opens pattern_vision.db and changes no schema there.
`tests/test_wisdom_publish_adapters_drafts.py` walks its imports.

A draft is written only with `WISDOM_PV_EXAMPLES_ENABLED` on; off, the daily step logs a
`would_publish` preview. Setup labels come from the vocabulary map
(`wisdom_vocab_maps` list `pv_FOCUSED_SETUPS`, W1 §3.2), never from a list typed here.
Approving a draft records the owner's decision; the insert into pattern_exemplars stays
a W5 item for when the Lab reopens.
"""
from __future__ import annotations

from api.services.wisdom.core import flags

CONSUMER = "pv_examples"
FLAG_ENV = "WISDOM_PV_EXAMPLES_ENABLED"
KIND = "pv_exemplar"
PV_LIST = "pv_FOCUSED_SETUPS"


def build_drafts(conn) -> list[dict]:
    from api.services.wisdom.publish.adapters import common, provenance

    setup_for = common.vocab_map(conn, PV_LIST)
    if not setup_for or not common.table_exists(conn, "wisdom_chart_images"):
        return []
    records = {r["record_id"]: r for r in common.select_records(
        conn, types=("CALL",),
        extra_where="r.record_id IN (SELECT linked_record_id FROM wisdom_chart_images "
                    "WHERE linked_record_id IS NOT NULL)")}
    drafts = []
    for img in conn.execute(
            "SELECT image_id, origin, public_url, r2_key, label_ticker, label_timeframe, frame_t_s, "
            "linked_record_id, status FROM wisdom_chart_images WHERE linked_record_id IS NOT NULL "
            "AND status IN ('provisional', 'confirmed') ORDER BY image_id"):
        rec = records.get(img["linked_record_id"])
        setup = setup_for.get(rec["vocab_id"]) if rec else None
        if not rec or not setup:
            continue
        status = "confirmed" if (img["status"] == "confirmed" and rec["status"] == "confirmed") else "provisional"
        ticker = common.normalize_ticker(rec["ticker"] or img["label_ticker"])
        asof = common.record_date(rec)
        # §8c.3: the payload is stamped AT BUILD, not at some future insert. When the
        # Pattern Intelligence Lab reopens and W5 writes this into `pattern_exemplars`,
        # the marker is already in the row it writes — a marker added later is a marker
        # the rows written in between never had.
        drafts.append({
            "subject_ref": f"wisdom_chart_images:{img['image_id']}",
            "title": common.clip(f"Pattern Vision exemplar — {setup} — {ticker} {asof or ''}", 200),
            "payload": provenance.stamp({
                "setup": setup, "image_id": img["image_id"], "origin": img["origin"],
                # Sunday Scans charts are public; a session frame is not, so it travels by R2 key only
                "public_url": img["public_url"] if img["origin"] == "sunday_scans" else None,
                "r2_key": img["r2_key"], "ticker": ticker, "timeframe": img["label_timeframe"] or rec["timeframe"],
                "asof_date": asof, "record_id": rec["record_id"], "note": f"wisdom:{rec['record_id']}",
                "by_user": "wisdom", "speaker": common.speaker(rec["author_id"]), "status": status,
                "target": "pattern_vision.pattern_exemplars — NOT written in W1 (Pattern Intelligence Lab paused)",
            }, consumer=CONSUMER, subject_ref=f"wisdom_chart_images:{img['image_id']}",
                locator=common.row_locator(rec), flag_env=FLAG_ENV, text_field="note"),
            "citations": [common.row_locator(rec)],
            "provisional": status != "confirmed",
        })
    return drafts


def daily(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common

    flag_on = flags.pv_examples_enabled()
    with store.read() as conn:
        drafts = build_drafts(conn)
    out = {"flag_on": flag_on, "drafts": len(drafts)}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    results: list = []
    with store.write() as conn:
        if flag_on:
            results = [common.upsert_draft(conn, kind=KIND, subject_ref=d["subject_ref"], title=d["title"],
                                           payload=d["payload"], citations=d["citations"],
                                           provisional=d["provisional"]) for d in drafts]
        common.log_publish(conn, CONSUMER, f"summary:drafts={len(drafts)}",
                           "export" if flag_on else "would_publish", FLAG_ENV, flag_on)
    return {**out, "inserted": results.count("inserted"), "updated": results.count("updated")}
