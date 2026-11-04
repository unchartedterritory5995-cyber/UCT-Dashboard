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
  apply(entries, p, applied_by)
                     -> writes them into a policy file (replacing an older entry for the same kb_id) and bumps the
                        policy version, after the CUMULATIVE guards (DAILY_CAP rows per UTC day, POLICY_CAP cleared rows
                        unless owner-signed bulk_clearance_approval), appending to a hash-chained audit log. Never
                        touches excluded_setup_mentions.mode or any other key. The tool cannot verify that a person
                        reviewed a row: that is process, and the owner signs.
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


# ── cumulative guards and the audit log (review #793) ─────────────────────────────────────────────────────────────
#: The per-run limit alone could be looped. These hold ACROSS runs:
#:   DAILY_CAP        at most this many rows cleared (added or replaced) per UTC day, counted from the audit log;
#:   POLICY_CAP       at most this many cleared_rows in the policy, unless the policy carries a complete owner-signed
#:                    `bulk_clearance_approval` {approved_by, approved_on, max_rows, reason}; then max_rows is the cap.
#: Every applied clearance is appended to an append-only, hash-chained audit log (who applied it, when, which row and
#: review); apply refuses to write if the log's chain is broken. The tool CANNOT verify that a person actually reviewed
#: a row: that is process, and the owner signs (RIGHTS-REVIEW.md).
DAILY_CAP = 20
POLICY_CAP = 25
AUDIT_NAME = "cleared-rows-audit.jsonl"
_GENESIS = "0" * 64


def _clock() -> float:
    """The wall clock (tests pin it)."""
    import time
    return time.time()


def audit_path_for(policy_path: Path) -> Path:
    return Path(policy_path).with_name(AUDIT_NAME)


def _line_sha(prev: str, rec: dict) -> str:
    import hashlib
    body = json.dumps({k: v for k, v in rec.items() if k != "sha"}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256((prev + body).encode("utf-8")).hexdigest()


def read_audit(path: Path) -> list[dict]:
    """The audit records, verifying the hash chain. Raises ValueError if any line is unreadable or the chain breaks."""
    p = Path(path)
    if not p.exists():
        return []
    out, prev = [], _GENESIS
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            raise ValueError(f"audit log line {i} is not JSON: the log was edited; nothing applied") from None
        if rec.get("prev") != prev or rec.get("sha") != _line_sha(prev, rec):
            raise ValueError(f"audit log chain broken at line {i}: the log was edited; nothing applied")
        prev = rec["sha"]
        out.append(rec)
    return out


def bulk_cap(pol: dict) -> int:
    """POLICY_CAP, or a complete owner-signed bulk approval's max_rows."""
    b = pol.get("bulk_clearance_approval")
    if isinstance(b, dict) and policy._APPROVER.match(str(b.get("approved_by") or "").strip()) \
            and policy._approved_on_ok(b.get("approved_on")) and str(b.get("reason") or "").strip():
        try:
            n = int(b.get("max_rows"))
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            return n
    return POLICY_CAP


def apply(new: list[dict], policy_path: Path, applied_by: str, audit_path: Optional[Path] = None,
          now: Optional[float] = None) -> dict:
    """Write the entries into this policy file, after the cumulative guards, and append one audit record per row.
    Returns {added, replaced, policy_version}. Raises ValueError (nothing written) when a guard refuses."""
    if not policy._APPROVER.match(str(applied_by or "").strip()):
        raise ValueError("applied_by must name the person applying these clearances")
    t = float(now if now is not None else _clock())
    day = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).date().isoformat()
    p = Path(policy_path)
    ap = Path(audit_path) if audit_path else audit_path_for(p)
    log_recs = read_audit(ap)
    today = sum(1 for r in log_recs if str(r.get("applied_at", ""))[:10] == day)
    if today + len(new) > DAILY_CAP:
        raise ValueError(f"daily cap: {today} row(s) already cleared today (UTC); {len(new)} more would exceed "
                         f"{DAILY_CAP}. No bulk re-admission")
    pol = json.loads(p.read_text(encoding="utf-8"))
    rows = [e for e in pol.get("cleared_rows") or [] if isinstance(e, dict)]
    by_id = {e.get("kb_id"): i for i, e in enumerate(rows)}
    added = sum(1 for e in new if e["kb_id"] not in by_id)
    cap = bulk_cap(pol)
    if len(rows) + added > cap:
        raise ValueError(f"policy cap: {len(rows)} cleared row(s) + {added} would exceed {cap}. More needs an "
                         "owner-signed bulk_clearance_approval in the policy")
    replaced = 0
    for e in new:
        if e["kb_id"] in by_id:
            rows[by_id[e["kb_id"]]] = e
            replaced += 1
        else:
            rows.append(e)
    pol["cleared_rows"] = sorted(rows, key=lambda e: int(e.get("kb_id") or 0))
    pol["policy_version"] = int(pol.get("policy_version") or 0) + 1
    stamp = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    prev = log_recs[-1]["sha"] if log_recs else _GENESIS
    lines = []
    for e in new:
        rec = {"applied_at": stamp, "applied_by": str(applied_by).strip(), "kb_id": e["kb_id"],
               "content_sha": e["content_sha"], "rights_review_ref": e["rights_review_ref"],
               "approved_by": e["approved_by"], "approved_on": e["approved_on"],
               "action": "replaced" if e["kb_id"] in by_id else "added", "policy_version": pol["policy_version"],
               "prev": prev}
        rec["sha"] = _line_sha(prev, rec)
        prev = rec["sha"]
        lines.append(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
    p.write_text(json.dumps(pol, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with ap.open("a", encoding="utf-8") as f:              # append-only
        f.write("".join(line + "\n" for line in lines))
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
