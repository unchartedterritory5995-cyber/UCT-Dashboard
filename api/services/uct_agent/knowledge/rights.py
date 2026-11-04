"""Per-row rights clearance for withheld Trading Brain knowledge rows (Track C safeguard a, 2026-11-04).

An admitted knowledge row that names an excluded setup is withheld (policy.excluded_setup_mentions, mode "withhold")
until a person reviews its provenance and rights and the row is listed in policy.cleared_rows with
{kb_id, content_sha, provenance_ref, rights_review_ref, approved_by, approved_on}. This module is the workflow for that
review, one row at a time:

  worksheet(kb_id)   -> a review worksheet for ONE row: its metadata, why it is withheld, its text, the content_sha of
                        that text and a blank decision block. A person fills the decision; nothing here does.
  validate(ws)       -> every reason the worksheet cannot clear its row (incomplete decision, the text changed since
                        review, a source that is not admitted, ...). Empty = it may be emitted.
  entries(wss)       -> the policy.cleared_rows entries for valid worksheets. NO BULK RE-ADMISSION: at most
                        MAX_PER_RUN rows per run, one row per worksheet, each with its OWN rights_review_ref.
  apply(entries, p)  -> writes them into a policy file (replacing an older entry for the same kb_id) and bumps the
                        policy version. Never touches excluded_setup_mentions.mode or any other key.
  status()           -> counts only (withheld, cleared and current, cleared but the text changed).

A clearance is bound to the text that was reviewed: kinds serves a cleared row only while the index's current
content_sha matches the entry's, so changed text loses its clearance automatically. Nothing here serves anything, and
Brain (UCT_AGENT_KNOWLEDGE) stays OFF. CLI: tools/kn_rights_review.py.
"""
from __future__ import annotations

import datetime
import json
import sqlite3
from pathlib import Path
from typing import Any, Optional

from api.services.uct_agent.knowledge import index, policy

WORKSHEET_FORMAT = "uct-kn-rights-worksheet/1"
MAX_PER_RUN = 10
DECISION_FIELDS = ("clear", "provenance_ref", "rights_review_ref", "approved_by", "approved_on", "notes")
_REF_MAX = 120


def _row(kb_id: int) -> Optional[dict]:
    try:
        c = index._connect()
    except sqlite3.Error:
        return None
    try:
        r = c.execute("SELECT kb_id, category, source, trader, created_at, title, content, content_sha, "
                      "mention_templates, definitional_templates, mention_error FROM docs WHERE kb_id = ?",
                      (int(kb_id),)).fetchone()
        return dict(r) if r else None
    except sqlite3.Error:
        return None
    finally:
        c.close()


def _withheld_because(r: dict) -> list[str]:
    out = []
    if r.get("definitional_templates"):
        out.append(f"definitional wording about excluded setup template(s): {r['definitional_templates']}")
    if r.get("mention_templates"):
        out.append(f"names excluded setup template(s): {r['mention_templates']}")
    if r.get("mention_error"):
        out.append("the mention check could not parse this row")
    return out


def worksheet(kb_id: int) -> dict:
    """A review worksheet for one row (raises ValueError when the row cannot be reviewed here)."""
    k = int(kb_id)
    if k <= 0:
        raise ValueError("kb_id must be a positive integer")
    r = _row(k)
    if r is None:
        raise ValueError(f"row {k} is not in the knowledge index")
    info = index.built_info()
    return {
        "format": WORKSHEET_FORMAT,
        "kb_id": k,
        "content_sha": r["content_sha"],
        "index_build": index.build_id(info),
        "policy_version": policy.version(),
        "row": {f: r.get(f) for f in ("source", "trader", "category", "created_at", "title")},
        "withheld_because": _withheld_because(r),
        "source_admitted": r["source"] in policy.admitted_sources(),
        "content": r["content"],
        "decision": {"clear": False, "provenance_ref": "", "rights_review_ref": "", "approved_by": "",
                     "approved_on": "", "notes": ""},
        "instructions": ("Review this ONE row's provenance and rights. Set decision.clear to true ONLY if UCT may serve "
                         "this exact text, and fill provenance_ref and rights_review_ref (your own review record for "
                         "THIS row), approved_by (a name) and approved_on (YYYY-MM-DD). A commentary label never makes "
                         "restricted content permissible. Do not commit this file: it holds the row's text."),
    }


def _date_ok(v: Any) -> bool:
    return policy._approved_on_ok(v)


def validate(ws: Any) -> list[str]:
    """Every reason this worksheet cannot clear its row. Empty = valid."""
    if not isinstance(ws, dict) or ws.get("format") != WORKSHEET_FORMAT:
        return ["not a rights worksheet (format)"]
    problems = []
    k = ws.get("kb_id")
    if isinstance(k, bool) or not isinstance(k, int) or k <= 0:
        return ["kb_id must be a positive integer"]
    d = ws.get("decision") if isinstance(ws.get("decision"), dict) else {}
    if d.get("clear") is not True:
        problems.append("decision.clear is not true (the reviewer did not clear this row)")
    for f in ("provenance_ref", "rights_review_ref"):
        v = str(d.get(f) or "").strip()
        if not v:
            problems.append(f"decision.{f} is empty")
        elif len(v) > _REF_MAX:
            problems.append(f"decision.{f} is longer than {_REF_MAX} characters")
    if not policy._APPROVER.match(str(d.get("approved_by") or "").strip()):
        problems.append("decision.approved_by is not a name")
    if not _date_ok(d.get("approved_on")):
        problems.append("decision.approved_on is not an ISO date (YYYY-MM-DD) on or before today")
    r = _row(k)
    if r is None:
        problems.append(f"row {k} is not in the current knowledge index")
        return problems
    sha = str(ws.get("content_sha") or "").strip().lower()
    if not policy._SHA.match(sha):
        problems.append("content_sha is not a sha256")
    elif sha != str(r["content_sha"] or "").lower():
        problems.append("the row's text changed since this worksheet was made: review the current text again")
    if r["source"] not in policy.admitted_sources():
        problems.append(f"the row's source ({r['source']}) is not admitted; clearing a row never admits its source")
    return problems


def entries(worksheets: list) -> list[dict]:
    """policy.cleared_rows entries for these worksheets, or ValueError naming every problem (nothing partial)."""
    wss = list(worksheets or [])
    errs = []
    if not wss:
        raise ValueError("no worksheets")
    if len(wss) > MAX_PER_RUN:
        raise ValueError(f"{len(wss)} rows in one run: no bulk re-admission (at most {MAX_PER_RUN} reviewed rows per run)")
    ids, refs = [], []
    for i, ws in enumerate(wss):
        for p in validate(ws):
            errs.append(f"worksheet {i + 1} (kb_id {ws.get('kb_id') if isinstance(ws, dict) else '?'}): {p}")
        if isinstance(ws, dict):
            ids.append(ws.get("kb_id"))
            refs.append(str((ws.get("decision") or {}).get("rights_review_ref") or "").strip())
    if len(set(ids)) != len(ids):
        errs.append("the same kb_id appears twice")
    if len({r for r in refs if r}) != len([r for r in refs if r]):
        errs.append("a rights_review_ref is shared by several rows: each row needs its own review record")
    if errs:
        raise ValueError("; ".join(errs))
    out = []
    for ws in wss:
        d = ws["decision"]
        out.append({"kb_id": ws["kb_id"], "content_sha": str(ws["content_sha"]).lower(),
                    "provenance_ref": str(d["provenance_ref"]).strip(),
                    "rights_review_ref": str(d["rights_review_ref"]).strip(),
                    "approved_by": str(d["approved_by"]).strip(), "approved_on": str(d["approved_on"]).strip()})
    return out


def apply(new: list[dict], policy_path: Path) -> dict:
    """Write the entries into this policy file. Returns {added, replaced, policy_version}."""
    p = Path(policy_path)
    pol = json.loads(p.read_text(encoding="utf-8"))
    rows = [e for e in pol.get("cleared_rows") or [] if isinstance(e, dict)]
    by_id = {e.get("kb_id"): i for i, e in enumerate(rows)}
    added = replaced = 0
    for e in new:
        if e["kb_id"] in by_id:
            rows[by_id[e["kb_id"]]] = e
            replaced += 1
        else:
            rows.append(e)
            added += 1
    pol["cleared_rows"] = sorted(rows, key=lambda e: int(e.get("kb_id") or 0))
    pol["policy_version"] = int(pol.get("policy_version") or 0) + 1
    p.write_text(json.dumps(pol, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"added": added, "replaced": replaced, "policy_version": pol["policy_version"]}


def status() -> dict:
    """Counts only: rows withheld for naming an excluded setup, cleared rows whose text still matches, cleared rows
    whose text changed (their clearance no longer applies) and cleared rows missing from the index."""
    rows = index.mention_rows()
    if rows is None:
        return {"ok": False, "reason": "the knowledge index cannot be read"}
    admitted = set(policy.admitted_sources())
    named = [r for r in rows if r[1] in admitted]
    cleared = policy.cleared_row_ids()
    shas = index.content_shas(cleared.keys()) or {}
    current = {k for k, s in cleared.items() if shas.get(k) == s}
    return {"ok": True, "admitted_rows_naming_excluded_setups": len(named),
            "withheld_now": len([r for r in named if r[0] not in current]),
            "cleared_current": len(current),
            "cleared_text_changed": len([k for k in cleared if k in shas and shas[k] != cleared[k]]),
            "cleared_missing_from_index": len([k for k in cleared if k not in shas]),
            "mode": policy.excluded_mentions_mode(),
            "as_of": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
