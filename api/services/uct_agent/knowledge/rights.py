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
import os
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


# ── server-side authorization, cumulative guards and the signed audit log (review #793; owner 2026-11-04) ─────────
#: AUTHORIZATION: every clearance and every bulk approval is signed with HMAC-SHA256 under a SERVER-HELD secret,
#: UCT_KN_RIGHTS_KEY (>= 32 characters; set only in the server environment, never in the repository). Anyone who can
#: edit policy.json or the audit log but does not hold the key cannot forge a clearance, a bulk approval or an audit
#: record. Without the key nothing can be cleared AND no cleared row is served (authorized() is empty).
#: RUNTIME: knowledge reads serve a cleared row only when authorized(): its policy entry is backed by a validly signed
#: audit record for that kb_id and content_sha, the log's last record is the head the policy recorded (audit_head),
#: and the number of cleared rows is within the cap. A hand-edited policy.json therefore serves nothing extra.
#: LIMITS (they hold across runs, log trimming, deletion and rotation):
#:   DAILY_CAP  rows cleared per UTC day, counted from the signed log. The policy records the log's head; a trimmed,
#:              deleted or rotated log no longer matches it, so apply refuses (and the rows it backed stop being served);
#:   POLICY_CAP cleared rows in total unless a SIGNED bulk_clearance_approval raises it, never above BULK_MAX.
#: CONCURRENCY: apply holds an exclusive lock file beside the policy for its whole read-check-write.
#: The tool CANNOT verify that a person actually reviewed a row: that is process, and the owner signs.
DAILY_CAP = 20
POLICY_CAP = 25
BULK_MAX = 200
AUDIT_NAME = "cleared-rows-audit.jsonl"
KEY_ENV = "UCT_KN_RIGHTS_KEY"
_GENESIS = "0" * 64
LOCK_WAIT_S = 10.0


def _clock() -> float:
    """The wall clock (tests pin it)."""
    import time
    return time.time()


def _key() -> Optional[bytes]:
    k = str(os.environ.get(KEY_ENV) or "")
    return k.encode("utf-8") if len(k) >= 32 else None


def _mac(key: bytes, text: str) -> str:
    import hashlib
    import hmac
    return hmac.new(key, text.encode("utf-8"), hashlib.sha256).hexdigest()


def audit_path_for(policy_path: Path) -> Path:
    return Path(policy_path).with_name(AUDIT_NAME)


def _line_sha(key: bytes, prev: str, rec: dict) -> str:
    body = json.dumps({k: v for k, v in rec.items() if k != "sha"}, sort_keys=True, separators=(",", ":"))
    return _mac(key, "audit|" + prev + body)


def read_audit(path: Path, key: Optional[bytes] = None) -> list[dict]:
    """The signed audit records. Raises ValueError without the server key, or if any line is unreadable or its
    signature / chain does not verify."""
    key = key or _key()
    if key is None:
        raise ValueError(f"no rights key on this server ({KEY_ENV}): nothing can be cleared or verified")
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
        if not isinstance(rec, dict) or rec.get("prev") != prev or rec.get("sha") != _line_sha(key, prev, rec):
            raise ValueError(f"audit log line {i} does not verify (edited, forged or out of order); nothing applied")
        prev = rec["sha"]
        out.append(rec)
    return out


def _bulk_fields(b: dict) -> str:
    return json.dumps({k: b.get(k) for k in ("approved_by", "approved_on", "max_rows", "reason")},
                      sort_keys=True, separators=(",", ":"))


def sign_bulk(approved_by: str, approved_on: str, max_rows: int, reason: str) -> dict:
    """A bulk_clearance_approval signed with the server key (the owner runs this where the key lives)."""
    key = _key()
    if key is None:
        raise ValueError(f"no rights key on this server ({KEY_ENV})")
    if not policy._APPROVER.match(str(approved_by or "").strip()) or not policy._approved_on_ok(approved_on):
        raise ValueError("approved_by must be a name and approved_on an ISO date on or before today")
    if not str(reason or "").strip():
        raise ValueError("a reason is required")
    if isinstance(max_rows, bool) or not isinstance(max_rows, int) or not POLICY_CAP < max_rows <= BULK_MAX:
        raise ValueError(f"max_rows must be an integer above {POLICY_CAP} and at most {BULK_MAX}")
    b = {"approved_by": str(approved_by).strip(), "approved_on": str(approved_on).strip(), "max_rows": max_rows,
         "reason": str(reason).strip()}
    return {**b, "signature": _mac(key, "bulk|" + _bulk_fields(b))}


def bulk_cap(pol: dict, key: Optional[bytes] = None) -> int:
    """POLICY_CAP, or a SIGNED bulk approval's max_rows (never above BULK_MAX). An unsigned or forged one is ignored."""
    key = key or _key()
    b = pol.get("bulk_clearance_approval")
    if key is None or not isinstance(b, dict):
        return POLICY_CAP
    n = b.get("max_rows")
    if isinstance(n, bool) or not isinstance(n, int) or not POLICY_CAP < n <= BULK_MAX:
        return POLICY_CAP
    import hmac
    if not hmac.compare_digest(str(b.get("signature") or ""), _mac(key, "bulk|" + _bulk_fields(b))):
        return POLICY_CAP
    if not policy._APPROVER.match(str(b.get("approved_by") or "").strip()) or not policy._approved_on_ok(b.get("approved_on")) \
            or not str(b.get("reason") or "").strip():
        return POLICY_CAP
    return n


def _latest(recs: list[dict]) -> dict:
    out = {}
    for r in recs:
        out[r.get("kb_id")] = r
    return out


def _backed(rows: list[dict], recs: list[dict]) -> list:
    """kb_ids of policy cleared_rows WITHOUT a matching signed audit record (latest record for the row, same sha)."""
    last = _latest(recs)
    return [e.get("kb_id") for e in rows
            if not (e.get("kb_id") in last and last[e["kb_id"]].get("content_sha") == str(e.get("content_sha") or "").lower())]


class _FileLock:
    def __init__(self, path: Path):
        self.path = Path(str(path) + ".lock")
        self.fd = None

    def __enter__(self):
        import time
        deadline = time.monotonic() + LOCK_WAIT_S
        while True:
            try:
                self.fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                return self
            except FileExistsError:
                if time.monotonic() > deadline:
                    raise ValueError("another rights apply is running (lock held); try again") from None
                time.sleep(0.05)

    def __exit__(self, *a):
        os.close(self.fd)
        try:
            os.unlink(str(self.path))
        except OSError:
            pass
        return False


def apply(new: list[dict], policy_path: Path, applied_by: str, audit_path: Optional[Path] = None,
          now: Optional[float] = None) -> dict:
    """Write the entries into this policy file after authorization and the cumulative guards, appending one SIGNED
    audit record per row. Returns {added, replaced, policy_version}. Raises ValueError (nothing written) on refusal."""
    key = _key()
    if key is None:
        raise ValueError(f"no rights key on this server ({KEY_ENV}): clearances can only be applied where it is set")
    if not policy._APPROVER.match(str(applied_by or "").strip()):
        raise ValueError("applied_by must name the person applying these clearances")
    t = float(now if now is not None else _clock())
    day = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).date().isoformat()
    p = Path(policy_path)
    ap = Path(audit_path) if audit_path else audit_path_for(p)
    with _FileLock(p):
        log_recs = read_audit(ap, key)
        pol = json.loads(p.read_text(encoding="utf-8"))
        head = log_recs[-1]["sha"] if log_recs else _GENESIS
        if str(pol.get("audit_head") or _GENESIS) != head:
            raise ValueError("the audit log does not end where the policy says it does (trimmed, deleted, rotated or "
                             "replaced); nothing applied")
        rows = [e for e in pol.get("cleared_rows") or [] if isinstance(e, dict)]
        unbacked = _backed(rows, log_recs)
        if unbacked:
            raise ValueError(f"cleared_rows without a signed audit record ({len(unbacked)}): the policy was edited by "
                             "hand; nothing applied")
        today = sum(1 for r in log_recs if str(r.get("applied_at", ""))[:10] == day)
        if today + len(new) > DAILY_CAP:
            raise ValueError(f"daily cap: {today} row(s) already cleared today (UTC); {len(new)} more would exceed "
                             f"{DAILY_CAP}. No bulk re-admission")
        by_id = {e.get("kb_id"): i for i, e in enumerate(rows)}
        added = sum(1 for e in new if e["kb_id"] not in by_id)
        cap = bulk_cap(pol, key)
        if len(rows) + added > cap:
            raise ValueError(f"policy cap: {len(rows)} cleared row(s) + {added} would exceed {cap}. More needs a "
                             "bulk_clearance_approval signed with the server key")
        replaced = 0
        for e in new:
            if e["kb_id"] in by_id:
                rows[by_id[e["kb_id"]]] = e
                replaced += 1
            else:
                rows.append(e)
        version = int(pol.get("policy_version") or 0) + 1
        stamp = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        prev, lines = head, []
        for e in new:
            rec = {"applied_at": stamp, "applied_by": str(applied_by).strip(), "kb_id": e["kb_id"],
                   "content_sha": e["content_sha"], "rights_review_ref": e["rights_review_ref"],
                   "approved_by": e["approved_by"], "approved_on": e["approved_on"],
                   "action": "replaced" if e["kb_id"] in by_id else "added", "policy_version": version, "prev": prev}
            rec["sha"] = _line_sha(key, prev, rec)
            prev = rec["sha"]
            lines.append(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
        with ap.open("a", encoding="utf-8") as f:              # append-only; the policy then records the new head
            f.write("".join(line + "\n" for line in lines))
        pol["cleared_rows"] = sorted(rows, key=lambda e: int(e.get("kb_id") or 0))
        pol["policy_version"] = version
        pol["audit_head"] = prev
        p.write_text(json.dumps(pol, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"added": added, "replaced": replaced, "policy_version": version}


_AUTH_CACHE: dict = {"key": None, "ids": {}}


def authorized() -> dict:
    """{kb_id: content_sha} of cleared rows the RUNTIME may serve: policy entries backed by the signed audit log, the
    log's head equal to the policy's audit_head, and the count within the cap. Anything else -> {} (default-deny)."""
    key = _key()
    want = policy.cleared_row_ids()
    if key is None or not want:
        return {}
    pp = policy.path()
    ap = audit_path_for(pp)
    try:
        ck = (str(pp), pp.stat().st_mtime_ns, ap.stat().st_mtime_ns if ap.exists() else None, hash(key))
    except OSError:
        return {}
    if _AUTH_CACHE["key"] == ck:
        return dict(_AUTH_CACHE["ids"])
    out: dict = {}
    try:
        recs = read_audit(ap, key)
        pol = policy.load()
        head = recs[-1]["sha"] if recs else _GENESIS
        if str(pol.get("audit_head") or _GENESIS) == head and len(want) <= bulk_cap(pol, key):
            last = _latest(recs)
            out = {k: sha for k, sha in want.items() if k in last and last[k].get("content_sha") == sha}
    except ValueError:
        out = {}
    _AUTH_CACHE.update(key=ck, ids=dict(out))
    return out


def status() -> dict:
    """Counts only: rows withheld for naming an excluded setup, cleared rows whose text still matches, cleared rows
    whose text changed (their clearance no longer applies) and cleared rows missing from the index."""
    rows = index.mention_rows()
    if rows is None:
        return {"ok": False, "reason": "the knowledge index cannot be read"}
    admitted = set(policy.admitted_sources())
    named = [r for r in rows if r[1] in admitted]
    cleared = authorized()
    shas = index.content_shas(cleared.keys()) or {}
    current = {k for k, s in cleared.items() if shas.get(k) == s}
    return {"ok": True, "admitted_rows_naming_excluded_setups": len(named),
            "withheld_now": len([r for r in named if r[0] not in current]),
            "cleared_current": len(current),
            "cleared_text_changed": len([k for k in cleared if k in shas and shas[k] != cleared[k]]),
            "cleared_missing_from_index": len([k for k in cleared if k not in shas]),
            "mode": policy.excluded_mentions_mode(),
            "as_of": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
