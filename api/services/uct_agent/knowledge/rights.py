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
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any, Optional

from api.services.uct_agent.knowledge import index, policy

log = logging.getLogger(__name__)

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
    """The server key, or None. QA #793: at least 32 characters AND at least 12 distinct characters (so "aaaa...",
    "abababab..." or a short repeated word never counts as a key)."""
    k = str(os.environ.get(KEY_ENV) or "")
    return k.encode("utf-8") if len(k) >= 32 and len(set(k)) >= 12 else None


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


BULK_MAX_DAYS = 90

# ── the server-side ANCHOR (QA #793 round 2: a rollback of the editable files must not undo a revocation) ─────────
#: policy.json and the audit log are both files an editor can roll back together: truncate the log before a revoke,
#: copy that line's sha into audit_head, restore the old cleared_rows. So the latest (seq, head) is ALSO recorded in a
#: server-side store OUTSIDE those files, written only by apply / revoke / reanchor with the key and MAC'd under it:
#: a small SQLite file on the server volume (UCT_KN_RIGHTS_ANCHOR, default <DATA_DIR>/kn_rights_anchor.sqlite).
#: authorized() and every write refuse unless the files' sequence (the number of signed records) and head EQUAL the
#: anchor. Rolling the files back leaves them behind the anchor, so nothing is served. Bulk approvals are bound to the
#: anchor's id, which lives only in that store. Residual (documented): someone who can also replace the anchor file on
#: the server volume, AND holds a matching old copy of it, can roll back; that is server-volume access, not an editor's.
ANCHOR_ENV = "UCT_KN_RIGHTS_ANCHOR"


def anchor_path() -> Path:
    v = os.environ.get(ANCHOR_ENV)
    if v:
        return Path(v)
    return Path(os.environ.get("DATA_DIR") or "/data") / "kn_rights_anchor.sqlite"


def _anchor_conn():
    import sqlite3
    ap = anchor_path()
    ap.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(ap), timeout=10.0)
    c.execute("CREATE TABLE IF NOT EXISTS rights_anchor (policy_id TEXT PRIMARY KEY, anchor_id TEXT NOT NULL, "
              "seq INTEGER NOT NULL, head TEXT NOT NULL, mac TEXT NOT NULL)")
    return c


def _anchor_mac(key: bytes, pid: str, aid: str, seq: int, head: str) -> str:
    return _mac(key, f"anchor|{pid}|{aid}|{int(seq)}|{head}")


def read_anchor(pid: Optional[str], key: bytes) -> Optional[dict]:
    """{anchor_id, seq, head} for this policy id, or None when there is none. Raises ValueError if it was edited."""
    if not pid:
        return None
    import contextlib
    import hmac
    with contextlib.closing(_anchor_conn()) as c:
        r = c.execute("SELECT anchor_id, seq, head, mac FROM rights_anchor WHERE policy_id = ?", (pid,)).fetchone()
    if r is None:
        return None
    if not hmac.compare_digest(str(r[3]), _anchor_mac(key, pid, r[0], r[1], r[2])):
        raise ValueError("the rights anchor does not verify (edited); nothing is served or applied")
    return {"anchor_id": r[0], "seq": int(r[1]), "head": r[2]}


def _write_anchor(pid: str, aid: str, seq: int, head: str, key: bytes) -> None:
    import contextlib
    with contextlib.closing(_anchor_conn()) as c:
        c.execute("INSERT INTO rights_anchor (policy_id, anchor_id, seq, head, mac) VALUES (?,?,?,?,?) "
                  "ON CONFLICT(policy_id) DO UPDATE SET anchor_id = excluded.anchor_id, seq = excluded.seq, "
                  "head = excluded.head, mac = excluded.mac", (pid, aid, int(seq), head, _anchor_mac(key, pid, aid, seq, head)))
        c.commit()


def _state(p: Path, ap: Path, key: bytes, create: bool = False) -> dict:
    """The verified state of a policy + log + anchor, or ValueError: the chain verifies, the policy's audit_head is the
    log's head, cleared_rows equal the log's active set, and the files' (seq, head) EQUAL the anchor (a fresh, empty
    policy may have no anchor yet; with create=True one is made for it)."""
    log_recs = read_audit(ap, key)
    pol = json.loads(p.read_text(encoding="utf-8"))
    head = log_recs[-1]["sha"] if log_recs else _GENESIS
    seq = len(log_recs)
    if str(pol.get("audit_head") or _GENESIS) != head:
        raise ValueError("the audit log does not end where the policy says it does (trimmed, deleted, rotated or "
                         "replaced); nothing applied")
    rows = [e for e in pol.get("cleared_rows") or [] if isinstance(e, dict)]
    if _mismatch(rows, log_recs):
        raise ValueError("cleared_rows and the signed audit log disagree: the policy was edited by hand (remove a "
                         "clearance with `revoke`); nothing applied")
    pid = pol.get("rights_policy_id") if isinstance(pol.get("rights_policy_id"), str) else None
    anc = read_anchor(pid, key)
    if anc is None:
        if seq or rows:
            raise ValueError("no rights anchor for a policy with clearances (rolled back or moved); nothing applied")
        if create:
            import secrets
            if not pid:
                pid = secrets.token_hex(16)
                pol["rights_policy_id"] = pid
                p.write_text(json.dumps(pol, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            anc = {"anchor_id": secrets.token_hex(16), "seq": 0, "head": _GENESIS}
            _write_anchor(pid, anc["anchor_id"], 0, _GENESIS, key)
    elif anc["seq"] != seq or anc["head"] != head:
        raise ValueError("the policy and audit log are not at the anchored state (rolled back or replaced); nothing "
                         "applied")
    return {"pol": pol, "recs": log_recs, "head": head, "seq": seq, "rows": rows, "pid": pid, "anchor": anc}


def _bulk_fields(b: dict) -> str:
    return json.dumps({k: b.get(k) for k in ("approved_by", "approved_on", "max_rows", "reason", "expires_on",
                                             "policy_id", "anchor_id")}, sort_keys=True, separators=(",", ":"))


def policy_id(policy_path: Path, create: bool = False) -> Optional[str]:
    """The policy file's rights id (`rights_policy_id`), which a bulk approval is bound to. Created only on request."""
    p = Path(policy_path)
    pol = json.loads(p.read_text(encoding="utf-8"))
    pid = pol.get("rights_policy_id")
    if isinstance(pid, str) and len(pid) == 32:
        return pid
    if not create:
        return None
    import secrets
    pol["rights_policy_id"] = secrets.token_hex(16)
    p.write_text(json.dumps(pol, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return pol["rights_policy_id"]


def sign_bulk(approved_by: str, approved_on: str, max_rows: int, reason: str, expires_on: str,
              policy_path: Path) -> dict:
    """A bulk_clearance_approval signed with the server key, EXPIRING (at most BULK_MAX_DAYS after approved_on) and
    BOUND to this policy file's rights id, so it cannot be replayed after expiry or copied into another policy."""
    key = _key()
    if key is None:
        raise ValueError(f"no rights key on this server ({KEY_ENV})")
    if not policy._APPROVER.match(str(approved_by or "").strip()) or not policy._approved_on_ok(approved_on):
        raise ValueError("approved_by must be a name and approved_on an ISO date on or before today")
    if not str(reason or "").strip():
        raise ValueError("a reason is required")
    if isinstance(max_rows, bool) or not isinstance(max_rows, int) or not POLICY_CAP < max_rows <= BULK_MAX:
        raise ValueError(f"max_rows must be an integer above {POLICY_CAP} and at most {BULK_MAX}")
    try:
        a, e = datetime.date.fromisoformat(str(approved_on)), datetime.date.fromisoformat(str(expires_on))
    except ValueError:
        raise ValueError("expires_on must be an ISO date") from None
    if not 0 < (e - a).days <= BULK_MAX_DAYS:
        raise ValueError(f"expires_on must be after approved_on and at most {BULK_MAX_DAYS} days later")
    p = Path(policy_path)
    with _FileLock(p):
        st = _state(p, audit_path_for(p), key, create=True)
    b = {"approved_by": str(approved_by).strip(), "approved_on": str(approved_on).strip(), "max_rows": max_rows,
         "reason": str(reason).strip(), "expires_on": str(expires_on), "policy_id": st["pid"],
         "anchor_id": st["anchor"]["anchor_id"]}
    return {**b, "signature": _mac(key, "bulk|" + _bulk_fields(b))}


def bulk_cap(pol: dict, key: Optional[bytes] = None, today: Optional[datetime.date] = None,
             anchor_id: Optional[str] = None) -> int:
    """POLICY_CAP, or a SIGNED, UNEXPIRED bulk approval bound to THIS policy (its rights_policy_id): its max_rows,
    never above BULK_MAX. Unsigned, forged, edited, expired or copied from another policy -> POLICY_CAP."""
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
    if not b.get("policy_id") or b.get("policy_id") != pol.get("rights_policy_id"):
        return POLICY_CAP                                      # copied from another policy file
    if not anchor_id or b.get("anchor_id") != anchor_id:
        return POLICY_CAP                                      # not bound to THIS server's anchor (QA #793 round 2)
    try:
        a, e = datetime.date.fromisoformat(str(b.get("approved_on"))), datetime.date.fromisoformat(str(b.get("expires_on")))
    except ValueError:
        return POLICY_CAP
    d = today or datetime.datetime.fromtimestamp(_clock(), datetime.timezone.utc).date()
    if not 0 < (e - a).days <= BULK_MAX_DAYS or d > e:
        return POLICY_CAP                                      # expired (or an over-long validity)
    return n


def _latest(recs: list[dict]) -> dict:
    out = {}
    for r in recs:
        out[r.get("kb_id")] = r
    return out


def active_from_log(recs: list[dict]) -> dict:
    """{kb_id: content_sha} the signed log says is cleared now: the latest record per row is added / replaced, not
    revoked (QA #793: a revocation is a signed, chained record)."""
    return {k: r.get("content_sha") for k, r in _latest(recs).items() if r.get("action") in ("added", "replaced")}


def _mismatch(rows: list[dict], recs: list[dict]) -> list:
    """kb_ids where the policy's cleared_rows and the signed log's active set disagree (either direction)."""
    active = active_from_log(recs)
    pol = {e.get("kb_id"): str(e.get("content_sha") or "").lower() for e in rows}
    return sorted({k for k in set(active) | set(pol) if active.get(k) != pol.get(k)}, key=str)


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
                os.write(self.fd, json.dumps({"pid": os.getpid(), "at": int(time.time())}).encode("utf-8"))
                return self
            except FileExistsError:
                if time.monotonic() > deadline:
                    try:
                        held = self.path.read_text(encoding="utf-8")[:200]
                    except OSError:
                        held = "?"
                    raise ValueError(f"another rights apply/revoke holds {self.path.name} ({held}). If no apply is "
                                     "running (it was killed), delete that file and run again; see RIGHTS-REVIEW.md") from None
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
        st = _state(p, ap, key, create=True)
        pol, log_recs, head, rows = st["pol"], st["recs"], st["head"], st["rows"]
        today = sum(1 for r in log_recs if str(r.get("applied_at", ""))[:10] == day and r.get("action") != "revoked")
        if today + len(new) > DAILY_CAP:
            raise ValueError(f"daily cap: {today} row(s) already cleared today (UTC); {len(new)} more would exceed "
                             f"{DAILY_CAP}. No bulk re-admission")
        by_id = {e.get("kb_id"): i for i, e in enumerate(rows)}
        added = sum(1 for e in new if e["kb_id"] not in by_id)
        cap = bulk_cap(pol, key, anchor_id=st["anchor"]["anchor_id"])
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
                   "provenance_ref": e["provenance_ref"],
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
        _write_anchor(st["pid"], st["anchor"]["anchor_id"], st["seq"] + len(lines), prev, key)
    return {"added": added, "replaced": replaced, "policy_version": version}


def revoke(kb_ids: list, policy_path: Path, revoked_by: str, reason: str, audit_path: Optional[Path] = None,
           now: Optional[float] = None) -> dict:
    """Remove clearances: one SIGNED, chained `revoked` audit record per row, and the rows leave cleared_rows. A row
    revoked this way is never served again by re-adding its old entry (the log's latest record says revoked)."""
    key = _key()
    if key is None:
        raise ValueError(f"no rights key on this server ({KEY_ENV}): clearances can only be revoked where it is set")
    if not policy._APPROVER.match(str(revoked_by or "").strip()):
        raise ValueError("revoked_by must name the person revoking")
    if not str(reason or "").strip():
        raise ValueError("a reason is required")
    ids = list(dict.fromkeys(kb_ids or []))
    if not ids:
        raise ValueError("no rows to revoke")
    t = float(now if now is not None else _clock())
    p = Path(policy_path)
    ap = Path(audit_path) if audit_path else audit_path_for(p)
    with _FileLock(p):
        st = _state(p, ap, key)
        pol, log_recs, head, rows = st["pol"], st["recs"], st["head"], st["rows"]
        if st["anchor"] is None:
            raise ValueError("nothing has been cleared on this policy; nothing revoked")
        active = active_from_log(log_recs)
        missing = [k for k in ids if k not in active]
        if missing:
            raise ValueError(f"not cleared now: {missing}; nothing revoked")
        version = int(pol.get("policy_version") or 0) + 1
        stamp = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        prev, lines = head, []
        for k in ids:
            rec = {"applied_at": stamp, "applied_by": str(revoked_by).strip(), "kb_id": k, "content_sha": active[k],
                   "action": "revoked", "reason": str(reason).strip()[:200], "policy_version": version, "prev": prev}
            rec["sha"] = _line_sha(key, prev, rec)
            prev = rec["sha"]
            lines.append(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
        with ap.open("a", encoding="utf-8") as f:
            f.write("".join(line + "\n" for line in lines))
        pol["cleared_rows"] = [e for e in rows if e.get("kb_id") not in set(ids)]
        pol["policy_version"] = version
        pol["audit_head"] = prev
        p.write_text(json.dumps(pol, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        _write_anchor(st["pid"], st["anchor"]["anchor_id"], st["seq"] + len(lines), prev, key)
    return {"revoked": len(ids), "policy_version": version}


def reanchor(policy_path: Path, by: str, reason: str) -> dict:
    """OWNER-ONLY recovery (needs the key) after a crash between a file write and the anchor write. FORWARD ONLY
    (QA #793 round 3): the files' signed log must EXTEND the anchored log (the record at the anchored seq carries the
    anchored head), so files rolled back behind the anchor are refused and a revocation can never be undone this way."""
    key = _key()
    if key is None:
        raise ValueError(f"no rights key on this server ({KEY_ENV})")
    if not policy._APPROVER.match(str(by or "").strip()) or not str(reason or "").strip():
        raise ValueError("a name and a reason are required")
    p = Path(policy_path)
    with _FileLock(p):
        recs = read_audit(audit_path_for(p), key)
        pol = json.loads(p.read_text(encoding="utf-8"))
        head = recs[-1]["sha"] if recs else _GENESIS
        rows = [e for e in pol.get("cleared_rows") or [] if isinstance(e, dict)]
        if str(pol.get("audit_head") or _GENESIS) != head or _mismatch(rows, recs):
            raise ValueError("the policy and the log do not agree with each other; fix that first")
        pid = pol.get("rights_policy_id")
        if not isinstance(pid, str) or not pid:
            raise ValueError("this policy has no rights_policy_id")
        old = read_anchor(pid, key)                          # an edited anchor raises: use `rebuild`, never this
        if old is None and (recs or rows):
            # QA #793 round 6: with NO anchor (lost or fresh volume) the files cannot be shown to be current: a clean
            # rollback to before a revoke would be accepted. Only `rebuild` (which then revokes everything) may proceed.
            raise ValueError("there is no rights anchor for files that hold clearances or audit records; re-anchoring "
                             "cannot tell a rollback from the current state. Run `rebuild` (it revokes every row), "
                             "then re-clear deliberately")
        if old is not None:
            at = old["seq"]
            if at > len(recs) or (at > 0 and recs[at - 1]["sha"] != old["head"]) or (at == 0 and old["head"] != _GENESIS):
                raise ValueError("the files are BEHIND or beside the anchored state (a rollback); re-anchoring only moves "
                                 "forward. Nothing changed")
        import secrets
        aid = old["anchor_id"] if old else secrets.token_hex(16)
        _write_anchor(pid, aid, len(recs), head, key)
    log.warning("[kn rights] re-anchored policy %s at seq %d by %s: %s", pid[:8], len(recs), str(by)[:40], str(reason)[:120])
    return {"seq": len(recs)}


def rebuild(policy_path: Path, by: str, reason: str, now: Optional[float] = None) -> dict:
    """OWNER-ONLY recovery (needs the key) when the signed log is BROKEN (an edited, deleted, reordered or forged line).
    Keeps the verified prefix, and treats EVERY row that any line after the break touches (or that the policy lists
    without the prefix's support) as REVOKED: the lines after a break cannot be trusted to say a row is still cleared,
    so a row revoked after the break can never come back. If a later line cannot be read at all, every row is revoked.
    Writes signed `revoked` records (reason: rebuild), the policy and the anchor; never reads the repository export."""
    key = _key()
    if key is None:
        raise ValueError(f"no rights key on this server ({KEY_ENV})")
    if not policy._APPROVER.match(str(by or "").strip()) or not str(reason or "").strip():
        raise ValueError("a name and a reason are required")
    t = float(now if now is not None else _clock())
    p = Path(policy_path)
    ap = audit_path_for(p)
    with _FileLock(p):
        lines = ap.read_text(encoding="utf-8").splitlines() if ap.exists() else []
        prefix, prev, bad_at = [], _GENESIS, None
        for i, line in enumerate(lines):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                rec = None
            if not isinstance(rec, dict) or rec.get("prev") != prev or rec.get("sha") != _line_sha(key, prev, rec):
                bad_at = i
                break
            prefix.append(rec)
            prev = rec["sha"]
        pol = json.loads(p.read_text(encoding="utf-8"))
        pid = pol.get("rights_policy_id")
        if not isinstance(pid, str) or not pid:
            raise ValueError("this policy has no rights_policy_id")
        if bad_at is None:
            # a log that VERIFIES is rebuilt only when there is no readable anchor to vouch for it (QA round 6); with an
            # anchor at this state there is nothing to rebuild (a crash before the anchor write: use reanchor)
            try:
                anc0 = read_anchor(pid, key)
            except ValueError:
                anc0 = None
            if anc0 is not None:
                raise ValueError("the signed log verifies and is anchored; nothing to rebuild (use reanchor after a crash)")
            bad_at = len(lines)
        active = active_from_log(prefix)
        # QA #793 round 5: an editor can cut the log back to BEFORE a revocation (truncate, delete the revoke line) and
        # then break it. If the verified prefix does not reach the anchored state (the anchored seq with the anchored
        # head), nothing after it can be trusted to say a row is still cleared: revoke EVERY row. Also when there is no
        # readable anchor to compare against.
        try:
            anc = read_anchor(pid, key)
        except ValueError:
            anc = None
        reaches = bool(anc) and anc["seq"] <= len(prefix) and (
            (anc["seq"] == 0 and anc["head"] == _GENESIS) or (anc["seq"] > 0 and prefix[anc["seq"] - 1]["sha"] == anc["head"]))
        tail, unreadable = lines[bad_at:], not reaches
        touched = set()
        for line in tail:
            try:
                r = json.loads(line)
                k = r.get("kb_id") if isinstance(r, dict) else None
                if k is None:
                    unreadable = True
                else:
                    touched.add(k)
            except ValueError:
                if line.strip():
                    unreadable = True
        listed = {e.get("kb_id"): str(e.get("content_sha") or "").lower()
                  for e in pol.get("cleared_rows") or [] if isinstance(e, dict)}
        touched |= {k for k, v in listed.items() if active.get(k) != v}
        revoke_now = sorted(active, key=str) if unreadable else sorted((k for k in active if k in touched), key=str)
        stamp = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        version = int(pol.get("policy_version") or 0) + 1
        new_lines, prev = [], (prefix[-1]["sha"] if prefix else _GENESIS)
        for k in revoke_now:
            rec = {"applied_at": stamp, "applied_by": str(by).strip(), "kb_id": k, "content_sha": active[k],
                   "action": "revoked", "reason": ("rebuild after a broken log: " + str(reason).strip())[:200],
                   "policy_version": version, "prev": prev}
            rec["sha"] = _line_sha(key, prev, rec)
            prev = rec["sha"]
            new_lines.append(json.dumps(rec, ensure_ascii=False, separators=(",", ":")))
        last = _latest(prefix)
        keep = {k: v for k, v in active.items() if k not in set(revoke_now)}
        rows = [{"kb_id": k, "content_sha": v, "provenance_ref": last[k].get("provenance_ref") or "rebuilt",
                 "rights_review_ref": last[k].get("rights_review_ref"), "approved_by": last[k].get("approved_by"),
                 "approved_on": last[k].get("approved_on")} for k, v in keep.items()]
        broken = ap.with_suffix(ap.suffix + f".broken-{int(t)}")
        if ap.exists():
            ap.replace(broken)                                     # kept for the owner's investigation
        ap.write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in prefix)
                      + "".join(x + "\n" for x in new_lines), encoding="utf-8")
        pol["cleared_rows"] = sorted(rows, key=lambda e: int(e.get("kb_id") or 0))
        pol["policy_version"] = version
        pol["audit_head"] = prev
        p.write_text(json.dumps(pol, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        try:
            old = read_anchor(pid, key)
        except ValueError:
            old = None
        import secrets
        _write_anchor(pid, old["anchor_id"] if old else secrets.token_hex(16), len(prefix) + len(new_lines), prev, key)
    log.warning("[kn rights] rebuilt policy %s after a broken log (line %d): %d kept, %d revoked, by %s: %s",
                pid[:8], bad_at + 1, len(keep), len(revoke_now), str(by)[:40], str(reason)[:120])
    return {"broken_at_line": bad_at + 1, "kept": len(keep), "revoked": len(revoke_now), "saved_as": broken.name}


_AUTH_CACHE: dict = {"key": None, "ids": {}}


def authorized() -> dict:
    """{kb_id: content_sha} of cleared rows the RUNTIME may serve: policy entries backed by the signed audit log, the
    log's head equal to the policy's audit_head, and the count within the cap. Anything else -> {} (default-deny)."""
    key = _key()
    want = policy.cleared_row_ids()                 # {} in minimal mode
    if key is None or not want or policy.minimal_mode():
        return {}
    pp = policy.path()
    ap = audit_path_for(pp)
    anc = anchor_path()
    try:
        ck = (str(pp), pp.stat().st_mtime_ns, ap.stat().st_mtime_ns if ap.exists() else None,
              anc.stat().st_mtime_ns if anc.exists() else None, hash(key))
    except OSError:
        return {}
    if _AUTH_CACHE["key"] == ck:
        return dict(_AUTH_CACHE["ids"])
    out: dict = {}
    try:
        # QA #793: the files must verify, agree with each other (cleared_rows == the log's active set) AND sit exactly
        # at the server-side anchor; a hand edit or a rollback of the files serves nothing
        st = _state(pp, ap, key)
        if st["anchor"] is not None and len(want) <= bulk_cap(st["pol"], key, anchor_id=st["anchor"]["anchor_id"]):
            active = {e.get("kb_id"): str(e.get("content_sha") or "").lower() for e in st["rows"]}
            if active == want:
                out = dict(want)
    except (ValueError, OSError):
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
