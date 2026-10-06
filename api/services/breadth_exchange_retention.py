"""Exchange Breadth V1 — archive RETENTION (owner-approved V1 policy, 2026-10-05).

FULL OWNER-VINTAGE BYTES → member-authoritative → FIVE COMPLETED TRADING SESSIONS → VERIFIED COMPACT EVIDENCE
→ eligible for retirement.  `p202609302026` (the approved substitute for the irrecoverable p202609292209) is a
PERMANENT full-byte pin.

A vintage's full bytes may be retired only when ALL hold (`eligibility`):
  A  the archive copy was created                (`<tag>/` + `<tag>.SHA256SUMS`)
  B  the archive copy is fully verified           (`breadth_vintage_archive.verify`, re-hashed now)
  C  a valid ARCHIVED acknowledgement exists
  D  every session the vintage owns is member-authoritative (inside a published, non-rollback pointer)
  E  >= 5 completed trading sessions since the LAST of those sessions first became authoritative
  F  a durable compact evidence record exists      (`evidence/<tag>.EVIDENCE.v1.json`, 0444, never rewritten)
  G  that record reads back and verifies           (`verify_evidence`)
  H  the vintage is not permanently pinned
  I  no HOLD / rollback-in-force / non-CURRENT runner state

⛔ RETIREMENT IS OFF. `retire()` refuses unless BREADTH_EXCH_RETENTION_RETIRE_ENABLED=1 AND every clause holds
re-proven at the moment of deletion; the runner never calls it in the initial deployment (owner: the first
production retirement happens only after the real-cycle proof).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sqlite3
import stat
import time
from typing import Optional

from api.services import breadth_exchange_authority as ea
from api.services import breadth_vintage_archive as va

POLICY = "exch-retention-v1"
HOT_SESSIONS = 5
PERMANENT_PINS = frozenset({"p202609302026"})
EVIDENCE_SCHEMA = "exch-vintage-evidence/1"
_REQUIRED = ("schema", "tag", "producer", "owned_sessions", "inputs", "ack", "ack_sha256", "archive_sums_sha256",
             "archive_sums", "verification", "code", "computed_sessions", "authority_versions", "created_at")


class Refused(Exception):
    def __init__(self, reason, detail=None):
        super().__init__("%s %s" % (reason, json.dumps(detail, default=str)[:400] if detail is not None else ""))
        self.reason, self.detail = reason, detail


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def evidence_dir(archive_dir: str) -> str:
    return os.path.join(archive_dir, "evidence")


def evidence_path(archive_dir: str, tag: str) -> str:
    return os.path.join(evidence_dir(archive_dir), "%s.EVIDENCE.v1.json" % tag)


# ── authority history: when did each session FIRST become member-authoritative? ─────────────────────
def authority_history(store) -> list:
    """Every published pointer, oldest first: [{version, published_at, latest_session, rollback_of}]."""
    out = []
    if store is None:
        return out
    v = 1
    while True:
        k = ea.key("history/%06d.json" % v)
        try:
            if not store.exists(k):
                break
            p = json.loads(store.get(k))
        except Exception:  # noqa: BLE001
            break
        out.append({"version": p["publication_version"], "published_at": p["published_at"],
                    "latest_session": p["live"]["latest_session"], "rollback_of": p.get("rollback_of"),
                    "live_sha256": p["live"]["sha256"]})
        v += 1
    return out


def member_authority_since() -> Optional[str]:
    """When NYSE/NASDAQ became MEMBER-authoritative ('YYYY-MM-DDTHH:MM:SSZ'), or None while members are dark.
    Recorded at the Gate B cutover as BREADTH_EXCH_MEMBER_AUTHORITY_SINCE on the runner. ⛔ A dark publication
    is NOT member authority: before this exists no session is member-authoritative and no clock runs."""
    v = (os.environ.get("BREADTH_EXCH_MEMBER_AUTHORITY_SINCE") or "").strip()
    return v or None


def first_authoritative(session: str, history: list, since: Optional[str] = None) -> Optional[dict]:
    """When `session` first became MEMBER-authoritative: the first non-rollback publication containing it,
    but never earlier than the member cutover `since` (a session published dark before the cutover became
    authoritative AT the cutover). None while members are dark."""
    if not since:
        return None
    for h in history:
        if not h["rollback_of"] and h["latest_session"] >= session:
            return dict(h, published_at=max(h["published_at"], since))
    return None


def member_versions(session: str, history: list, since: Optional[str]) -> list:
    """The publication versions that served `session` TO MEMBERS: the pointer in force at the cutover
    (the last non-rollback publication at or before `since`) and every non-rollback one after it, each only
    if it contains the session. [] while members are dark."""
    if not since:
        return []
    live = [h for h in history if not h["rollback_of"]]
    at_cutover = [h for h in live if h["published_at"] <= since][-1:]
    after = [h for h in live if h["published_at"] > since]
    return [h["version"] for h in at_cutover + after if h["latest_session"] >= session]


def completed_sessions_since(day_iso: str, today_iso: str) -> int:
    """Trading sessions strictly after `day_iso` and strictly before `today_iso` (i.e. completed)."""
    cal = ea._cal()
    d, n = dt.date.fromisoformat(day_iso) + dt.timedelta(days=1), 0
    while d.isoformat() < today_iso:
        if cal.is_trading_day(d.isoformat()):
            n += 1
        d += dt.timedelta(days=1)
    return n


# ── the compact evidence record ─────────────────────────────────────────────────────────────────────
def build_evidence(archive_dir: str, tag: str, producer_root: str, store_db: str, history: list,
                   code: dict) -> dict:
    """Everything needed to establish the vintage's identity and provenance without its full bytes.
    Re-verifies the archive first (B); refuses rather than record an unverified archive."""
    ack = va.verify(archive_dir, tag)                                 # B + C, re-hashed now
    ack_bytes = open(va.ack_path(archive_dir, tag), "rb").read()
    sums_bytes = open(va.sums_path(archive_dir, tag), "rb").read()
    prod = {"tag": tag}
    sp, cp = os.path.join(producer_root, "state.db"), os.path.join(producer_root, "v2_live.db")
    if os.path.exists(sp):
        c = sqlite3.connect("file:%s?immutable=1" % sp, uri=True)
        try:
            r = c.execute("SELECT last_session, created_at, state, report FROM vintage WHERE tag=?", (tag,)).fetchone()
        finally:
            c.close()
        if r:
            prod.update(last_session=r[0], created_at=r[1], state=r[2], gate_report_sha256=_sha((r[3] or "").encode()))
    owned = []
    if os.path.exists(cp):
        c = sqlite3.connect("file:%s?immutable=1" % cp, uri=True)
        try:
            for d, pid, sha, prov in c.execute("SELECT date, pub_id, sha256, provenance FROM v2_session ORDER BY date"):
                pv = json.loads(prov)
                if pv.get("vintage_tag") == tag:
                    owned.append({"date": d, "pub_id": pid, "pub_sha256": sha,
                                  "input_manifest_sha256": pv.get("input_manifest_sha256"),
                                  "reference_sha256": pv.get("reference_sha256"),
                                  "pit_ledger_sha256": pv.get("pit_ledger_sha256")})
        finally:
            c.close()
    computed = []
    if os.path.exists(store_db):
        c = sqlite3.connect("file:%s?mode=ro" % store_db, uri=True)
        try:
            for d, own, cv, rs, ims, ref in c.execute(
                    "SELECT date, vintage, compute_vintage, rows_sha256, input_manifest_sha256, reference_sha256 "
                    "FROM live_session WHERE vintage=? OR compute_vintage=? ORDER BY seq", (tag, tag)):
                computed.append({"date": d, "owner_of_record": own, "compute_vintage": cv, "rows_sha256": rs,
                                 "input_manifest_sha256": ims, "reference_sha256": ref})
        finally:
            c.close()
    sessions = sorted({o["date"] for o in owned} | {x["date"] for x in computed})
    versions = {d: member_versions(d, history, member_authority_since()) for d in sessions}
    return {"schema": EVIDENCE_SCHEMA, "policy": POLICY, "tag": tag, "producer": prod, "owned_sessions": owned,
            "inputs": ack["inputs"], "ack": json.loads(ack_bytes), "ack_sha256": _sha(ack_bytes),
            "archive_sums_sha256": _sha(sums_bytes), "archive_sums": sums_bytes.decode(),
            "verification": {"verified": True, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                             "files": ack["archive"]["files"], "bytes": ack["archive"]["bytes"],
                             "required_listing_sha256": ack["required"]["listing_sha256"]},
            "code": dict(code), "computed_sessions": computed, "authority_versions": versions,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def write_evidence(archive_dir: str, doc: dict) -> str:
    """Immutable: written once (tmp → fsync → rename), 0444; an existing record is never rewritten."""
    p = evidence_path(archive_dir, doc["tag"])
    if os.path.exists(p):
        return p
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    os.replace(tmp, p)
    return p


def verify_evidence(archive_dir: str, tag: str) -> dict:
    """Read the record BACK and verify it independently: required fields, its own embedded SUMS == its
    recorded hash == the archive's SUMS file, embedded ack == the ack file, required listing recomputes from
    the embedded SUMS, every owned/computed session present and its authority versions recorded."""
    p = evidence_path(archive_dir, tag)
    if not os.path.exists(p):
        raise Refused("EVIDENCE_MISSING", tag)
    try:
        doc = json.load(open(p, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        raise Refused("EVIDENCE_MALFORMED", type(e).__name__)
    missing = [k for k in _REQUIRED if k not in doc]
    if missing or doc.get("schema") != EVIDENCE_SCHEMA or doc.get("tag") != tag:
        raise Refused("EVIDENCE_MALFORMED", {"missing": missing, "tag": doc.get("tag")})
    sums = doc["archive_sums"].encode()
    if _sha(sums) != doc["archive_sums_sha256"]:
        raise Refused("EVIDENCE_SUMS_SELF_MISMATCH", tag)
    sp = va.sums_path(archive_dir, tag)
    if os.path.exists(sp) and _sha(open(sp, "rb").read()) != doc["archive_sums_sha256"]:
        raise Refused("EVIDENCE_SUMS_MISMATCH", tag)
    ap = va.ack_path(archive_dir, tag)
    if os.path.exists(ap) and _sha(open(ap, "rb").read()) != doc["ack_sha256"]:
        raise Refused("EVIDENCE_ACK_MISMATCH", tag)
    if doc["ack"].get("tag") != tag or doc["ack"].get("archive", {}).get("sums_sha256") != doc["archive_sums_sha256"]:
        raise Refused("EVIDENCE_ACK_INCONSISTENT", tag)
    listing = {}
    for line in doc["archive_sums"].splitlines():
        h, _s, rel = line.partition("  ")
        if va.is_required(rel, tag):
            listing[rel] = h
    if va.listing_sha256(listing) != doc["ack"]["required"]["listing_sha256"]:
        raise Refused("EVIDENCE_LISTING_MISMATCH", tag)
    if doc["verification"].get("verified") is not True:
        raise Refused("EVIDENCE_UNVERIFIED", tag)
    for s in {o["date"] for o in doc["owned_sessions"]} | {x["date"] for x in doc["computed_sessions"]}:
        if not doc["authority_versions"].get(s):
            raise Refused("EVIDENCE_SESSION_NOT_AUTHORITATIVE", s)
    return doc


# ── eligibility A–I ─────────────────────────────────────────────────────────────────────────────────
def eligibility(archive_dir: str, tag: str, owned: list, history: list, today_iso: str, runner_state: str,
                hold: bool, full_verify: bool = False, since: Optional[str] = "env") -> dict:
    """{clause: bool, ..., eligible: bool, why: [...]}. `owned` = every session the vintage owns (incl. a
    declared substitute's sessions). Cheap by default (A, C by file + SUMS identity); B is re-hashed only with
    `full_verify` (always at retirement)."""
    r: dict = {"tag": tag}
    r["A_archived"] = os.path.isdir(os.path.join(archive_dir, tag)) and os.path.exists(va.sums_path(archive_dir, tag))
    state = va.cheap_state(archive_dir, tag)
    r["C_ack_valid"] = state == "acked"
    if full_verify:
        try:
            va.verify(archive_dir, tag)
            r["B_verified"] = True
        except va.AckRefused as e:
            r["B_verified"], r["B_reason"] = False, e.reason
    else:
        r["B_verified"] = r["C_ack_valid"]                    # re-proven in full at retirement time
    since = member_authority_since() if since == "env" else since
    r["member_authority_since"] = since
    first = {d: first_authoritative(d, history, since) for d in owned}
    r["D_all_owned_authoritative"] = bool(owned) and all(first.values())
    if r["D_all_owned_authoritative"]:
        last = max(owned)
        became = first[last]["published_at"][:10]
        r["E_sessions_since_authoritative"] = completed_sessions_since(became, today_iso)
        r["E_five_completed"] = r["E_sessions_since_authoritative"] >= HOT_SESSIONS
    else:
        r["E_sessions_since_authoritative"], r["E_five_completed"] = None, False
    try:
        verify_evidence(archive_dir, tag)
        r["F_evidence_exists"] = r["G_evidence_verifies"] = True
    except Refused as e:
        r["F_evidence_exists"] = e.reason != "EVIDENCE_MISSING"
        r["G_evidence_verifies"], r["G_reason"] = False, e.reason
    r["H_not_pinned"] = tag not in PERMANENT_PINS
    r["I_no_hold_or_recovery"] = (not hold) and runner_state in ("CURRENT", "CURRENT_WITH_PRUNE_BLOCKED")
    clauses = [k for k in r if k[:2] in ("A_", "B_", "C_", "D_", "F_", "G_", "H_", "I_")
               and isinstance(r[k], bool)] + ["E_five_completed"]
    r["why_not"] = [k for k in clauses if not r[k]]
    r["eligible"] = not r["why_not"]
    return r


def retire(archive_dir: str, tag: str, **kw) -> dict:
    """⛔ OFF in the initial deployment. Deletes ONLY `<archive>/<tag>/` (the full bytes); SUMS, ack and the
    evidence record stay. Every clause is re-proven here, B by a full re-hash, immediately before deletion."""
    if os.environ.get("BREADTH_EXCH_RETENTION_RETIRE_ENABLED") != "1":
        raise Refused("RETIREMENT_DISABLED", tag)
    e = eligibility(archive_dir, tag, full_verify=True, **kw)
    if not e["eligible"]:
        raise Refused("NOT_ELIGIBLE", e["why_not"])
    import shutil
    root = os.path.join(archive_dir, tag)
    for dp, dns, fns in os.walk(root):
        for n in dns + fns:
            os.chmod(os.path.join(dp, n), stat.S_IRWXU)
    shutil.rmtree(root)
    return {"retired": tag, "eligibility": e}
