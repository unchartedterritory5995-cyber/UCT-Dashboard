"""Exchange Breadth V1 — the scheduled runner. Lives INSIDE the existing `breadth-v2-runner` service
(`api.breadth_v2_producer_main`), as a second thread kicked after every producer tick, so the dependency
order is the producer's own:

    US V2 PUBLICATION  (producer tick: CURRENT sessions in v2_live.db)
      → ARCHIVE + ACK  (every READY vintage → <archive>/<tag>/ + SUMS + ARCHIVED.json; the producer's prune
                        guard re-verifies before deleting anything)
      → COMPUTE        (exch_live_leg --mode append, the in-repo pinned engine via run_overlay.py)
      → VALIDATE       (validate_live_store.py — independent of the leg's code path)
      → PUBLISH        (breadth_exchange_publish: snapshot → upload → proven candidate → ONE pointer PUT)

Each step is gated by its own flag (all default OFF): BREADTH_EXCH_ARCHIVER_ENABLED,
BREADTH_EXCH_COMPUTE_ENABLED, BREADTH_EXCH_PUBLISH_ENABLED. The loop itself needs
BREADTH_EXCH_RUNNER_ENABLED=1. `<runner root>/HOLD` parks it.

⛔ SINGLE WRITER: a non-blocking flock; a second invocation (another thread, a manual run, a second
replica) returns SKIPPED_DUPLICATE and touches nothing. The leg holds its own store flock as well.
⛔ ISOLATION FROM US V2: every step runs after the producer's tick has returned; compute runs in a child
process with a timeout and `nice`; a failure here never fails, delays or alters a US V2 publication.
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from typing import Optional

from api.services import breadth_exchange_authority as ea
from api.services import breadth_v2_producer as prod
from api.services import breadth_vintage_archive as va

REPO = ea.REPO
TOOLS = os.path.join(REPO, "tools", "breadth_exch")
PARENTS_ROOT = os.environ.get("BREADTH_EXCH_PARENTS_ROOT", "/data/_audit/exch_v1")
RUNNER_ROOT = os.environ.get("BREADTH_EXCH_RUNNER_ROOT", "/data/_audit/exch_v1/live_v1")
STORE_DIR = os.environ.get("BREADTH_EXCH_STORE_DIR", "/data/_audit/exch_v1/live_v1/candidate")
STORE_DB = "exch_live_candidate_v1.db"
COMPUTE_TIMEOUT = int(os.environ.get("BREADTH_EXCH_COMPUTE_TIMEOUT", "14400"))
_KICK = threading.Event()
_STATE: dict = {"last": None}


def _flag(name: str) -> bool:
    return os.environ.get(name) == "1"


def _utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def code_commit() -> str:
    """An explicit BREADTH_EXCH_CODE_COMMIT wins (a code directory that is not the deployed image), else
    the deployed image's own commit."""
    return (os.environ.get("BREADTH_EXCH_CODE_COMMIT") or os.environ.get("RAILWAY_GIT_COMMIT_SHA")
            or "unrecorded")[:40]


def _lc():
    return ea._lc()


def _write_json(path: str, doc: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp.%d" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(doc, f, indent=1, sort_keys=True, default=str)
    os.replace(tmp, path)


def status_path() -> str:
    return os.path.join(RUNNER_ROOT, "RUNNER_STATUS.json")


def _producer_view() -> dict:
    """Immutable reads of the producer's records: what US V2 has published, from which vintage."""
    out = {"published": {}, "ready": [], "states": {}}
    sp, cp = os.path.join(prod.ROOT, "state.db"), os.path.join(prod.ROOT, "v2_live.db")
    if os.path.exists(cp):
        c = sqlite3.connect("file:%s?immutable=1" % cp, uri=True)
        try:
            for d, prov in c.execute("SELECT date, provenance FROM v2_session"):
                out["published"][d] = json.loads(prov).get("vintage_tag")
        finally:
            c.close()
    if os.path.exists(sp):
        c = sqlite3.connect("file:%s?immutable=1" % sp, uri=True)
        try:
            out["ready"] = [r[0] for r in c.execute("SELECT tag FROM vintage WHERE state='ready'")]
            out["states"] = dict(c.execute("SELECT date, state FROM session"))
        finally:
            c.close()
    return out


def _store_view() -> dict:
    p = os.path.join(STORE_DIR, STORE_DB)
    if not os.path.exists(p):
        return {"sessions": [], "logical_sha256": None}
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    try:
        return {"sessions": [r[0] for r in c.execute("SELECT date FROM live_session ORDER BY seq")],
                "logical_sha256": _lc().logical_sha256_conn(c)}
    finally:
        c.close()


def _declared_exceptions() -> dict:
    """{session: (true_owner, substitute)} from the hash-pinned declaration (the leg re-verifies the pin)."""
    try:
        doc = json.load(open(os.path.join(TOOLS, "pinned", "breadth_exch_owner_vintage_exceptions.json")))
        return {e["session"]: (e["true_owner_vintage"], e["substitute_vintage"]) for e in doc.get("exceptions", [])}
    except Exception:  # noqa: BLE001
        return {}


def required_vintage(d: str, owner: str, exc: dict) -> str:
    """The archive a pending session needs: its owner — or, ONLY for a declared session whose published
    owner IS the declared true owner, the declared substitute. Nothing else is ever waived."""
    if d in exc and exc[d][0] == owner:
        return exc[d][1]
    return owner


def _run(args: list, log: str, timeout: int, run=subprocess.run) -> int:
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, "a") as lf:
        lf.write("\n== %s %s\n" % (_utc(), " ".join(args)))
        lf.flush()
        try:
            return run(args, cwd=REPO, stdout=lf, stderr=subprocess.STDOUT, timeout=timeout,
                       env=dict(os.environ, PYTHONPATH=REPO)).returncode
        except subprocess.TimeoutExpired:
            lf.write("TIMEOUT after %ss\n" % timeout)
            return 124


def compute_args() -> list:
    ro = os.path.join(TOOLS, "run_overlay.py")
    return [sys.executable, ro, os.path.join(TOOLS, "exch_live_leg.py"), "--store", STORE_DIR, "--mode", "append",
            "--code-commit", code_commit(), "--root", PARENTS_ROOT, "--prod-root", prod.ROOT,
            "--archive", prod.EXCH_ARCHIVE_DIR, "--launch", ro]


def _lock():
    import fcntl
    os.makedirs(RUNNER_ROOT, exist_ok=True)
    f = open(os.path.join(RUNNER_ROOT, "exch_runner.lock"), "w")
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def cycle(run=subprocess.run, store=None) -> dict:
    """One dependency-ordered pass. Idempotent: re-running with no new input changes nothing."""
    lk = _lock()
    if lk is None:
        return {"state": "SKIPPED_DUPLICATE", "at": _utc()}
    try:
        return _cycle(run, store)
    finally:
        lk.close()


def _cycle(run, store) -> dict:
    st: dict = {"at": _utc(), "code_commit": code_commit(), "steps": {}}
    if os.path.exists(os.path.join(RUNNER_ROOT, "HOLD")):
        st["state"] = "PARKED"
        _write_json(status_path(), st)
        return st
    pv = _producer_view()
    published = sorted(d for d in pv["published"] if d >= ea.LIVE_START)
    # 1 ─ archive + acknowledge (before anything else: it is what releases the producer's prune guard)
    if _flag("BREADTH_EXCH_ARCHIVER_ENABLED"):
        try:
            st["steps"]["archive"] = _lc().archive_vintages(os.path.join(prod.ROOT, "vintages"), pv["ready"],
                                                            prod.EXCH_ARCHIVE_DIR, code_commit=code_commit())
        except Exception as e:  # noqa: BLE001
            st["steps"]["archive"] = {"error": "%s: %s" % (type(e).__name__, e)}
            prod._alarm("critical", "Exchange archiver failed: %s" % st["steps"]["archive"]["error"], None)
    ack = {t: va.cheap_state(prod.EXCH_ARCHIVE_DIR, t) for t in sorted(set(pv["published"].values()) | set(pv["ready"]))}
    before = _store_view()
    pending = [d for d in published if d not in set(before["sessions"])]
    exc = _declared_exceptions()
    need = {required_vintage(d, pv["published"][d], exc) for d in pending}
    ack.update({t: va.cheap_state(prod.EXCH_ARCHIVE_DIR, t) for t in need if t not in ack})
    owners_unarchived = sorted(t for t in need if ack.get(t) != "acked")
    # 2 ─ compute (only what US V2 has published; the leg itself re-proves every owner and refuses gaps)
    if _flag("BREADTH_EXCH_COMPUTE_ENABLED") and pending and not owners_unarchived:
        rc = _run(compute_args(), os.path.join(RUNNER_ROOT, "logs", "compute.log"), COMPUTE_TIMEOUT, run)
        leg = {}
        try:
            leg = json.load(open(os.path.join(STORE_DIR, "STATUS.json")))
        except Exception:  # noqa: BLE001
            pass
        st["steps"]["compute"] = {"rc": rc, "appended": leg.get("appended"), "refused": leg.get("refused")}
    after = _store_view()
    # 3 ─ validate (independent), whenever the store's content is not the last validated content
    vpath = os.path.join(RUNNER_ROOT, "VALIDATION_LATEST.json")
    last_val = {}
    try:
        last_val = json.load(open(vpath))
    except Exception:  # noqa: BLE001
        pass
    validated = last_val.get("logical_sha256") == after["logical_sha256"] and last_val.get("pass") is True
    if after["sessions"] and not validated:
        out = os.path.join(RUNNER_ROOT, "validation", "validate_%s.json" % after["logical_sha256"][:12])
        rc = _run([sys.executable, os.path.join(TOOLS, "validate_live_store.py"), os.path.join(STORE_DIR, STORE_DB),
                   out, PARENTS_ROOT], os.path.join(RUNNER_ROOT, "logs", "validate.log"), 1800, run)
        try:
            ok = rc == 0 and json.load(open(out))["pass"] is True
        except Exception:  # noqa: BLE001
            ok = False
        validated = ok
        _write_json(vpath, {"logical_sha256": after["logical_sha256"], "pass": ok, "report": out, "at": _utc()})
        st["steps"]["validate"] = {"pass": ok, "report": out}
    # 4 ─ publish (the single member-visible step; proven before the pointer moves)
    store = store or (ea.object_store() if _flag("BREADTH_EXCH_PUBLISH_ENABLED") else None)
    if _flag("BREADTH_EXCH_PUBLISH_ENABLED") and validated and store is not None:
        from api.services import breadth_exchange_publish as ep
        try:
            st["steps"]["publish"] = ep.publish(
                store, os.path.join(STORE_DIR, STORE_DB),
                os.path.join(PARENTS_ROOT, "final", ea.HIST_NAME), os.path.join(PARENTS_ROOT, "final", ea.DER_NAME),
                code_commit())
        except Exception as e:  # noqa: BLE001
            st["steps"]["publish"] = {"error": "%s: %s" % (type(e).__name__, e),
                                      "reason": getattr(e, "reason", None)}
    authority = None
    if store is not None:
        try:
            from api.services import breadth_exchange_publish as ep
            cur = ep.current(store)
            authority = cur and {"publication_version": cur["pointer"]["publication_version"],
                                 "latest_session": cur["pointer"]["live"]["latest_session"],
                                 "rollback_of": cur["pointer"].get("rollback_of"),
                                 "logical_sha256": cur["pointer"]["live"]["logical_sha256"]}
        except Exception as e:  # noqa: BLE001
            authority = {"error": "%s: %s" % (type(e).__name__, e)}
    st.update(currentness(published, pv, after, ack, owners_unarchived, validated, authority))
    _write_json(status_path(), st)
    _STATE["last"] = st
    return st


def currentness(published, pv, store, ack, owners_unarchived, validated, authority) -> dict:
    """The operator's questions, answered from evidence."""
    should = published[-1] if published else None
    have = (authority or {}).get("latest_session")
    latest_in_store = store["sessions"][-1] if store["sessions"] else None
    guard = prod._guard_status_safe()
    leg = {}
    try:
        leg = json.load(open(os.path.join(STORE_DIR, "STATUS.json")))
    except Exception:  # noqa: BLE001
        pass
    refused = (leg.get("refused") or {}).get("reason")
    behind = len([d for d in published if have is None or d > have])
    if authority and authority.get("rollback_of"):
        state = "ROLLBACK_IN_FORCE"
    elif owners_unarchived:
        state = "WAITING_FOR_ARCHIVE"
    elif should is None or (have == should and latest_in_store == should and validated):
        state = "CURRENT"
    elif latest_in_store == should and validated and authority is None:
        state = "CURRENT_UNPUBLISHED"
    elif refused and refused != "NOT_YET_PUBLISHED":
        state = "STALE (%s)" % refused
    else:
        state = "BEHIND (%d session%s)" % (behind, "" if behind == 1 else "s")
    if state == "CURRENT" and guard.get("prune_blocked_count"):
        state = "CURRENT_WITH_PRUNE_BLOCKED"
    owner = pv["published"].get(should) if should else None
    return {"state": state,
            "members_should_have": should, "members_have": have, "latest_in_store": latest_in_store,
            "sessions_behind": behind if should else 0,
            "owner_vintage_latest": owner, "owner_archived": ack.get(owner) == "acked" if owner else None,
            "owners_unarchived": owners_unarchived,
            "venue_evidence_ready": ((leg.get("currentness") or {}).get("latest_venue_evidence_session") or "")
            >= (latest_in_store or "9999"),
            "identity_ready": refused not in ("IDENTITY_SUCCESSOR", "BRIDGE_UNRESOLVED"),
            "compute_passed": refused is None, "validation_passed": validated,
            "authority_current": bool(should) and have == should, "authority": authority,
            "leg_currentness": leg.get("currentness"), "leg_refused": leg.get("refused"),
            "archive_guard": {k: guard.get(k) for k in ("level", "reasons", "prune_blocked_count",
                                                        "oldest_prune_blocked", "unarchived_ready_vintages",
                                                        "verification_failures", "disk")}}


def kick() -> None:
    _KICK.set()


def loop(interval: int = 900) -> None:
    """The exchange thread inside the producer service. Woken by `kick()` after each producer tick, and
    at least every `interval` seconds. Never raises."""
    while True:
        _KICK.wait(timeout=interval)
        _KICK.clear()
        try:
            _STATE["last"] = cycle()
        except Exception as e:  # noqa: BLE001
            _STATE["last"] = {"state": "FAILED", "error": "%s: %s" % (type(e).__name__, e), "at": _utc()}
            prod._alarm("critical", "Exchange runner cycle failed: %s" % _STATE["last"]["error"], None)


def status() -> dict:
    try:
        return json.load(open(status_path()))
    except Exception:  # noqa: BLE001
        return _STATE["last"] or {"state": "NEVER_RAN"}
