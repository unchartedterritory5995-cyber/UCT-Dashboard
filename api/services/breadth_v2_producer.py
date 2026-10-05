"""The dedicated daily Breadth V2 producer — the ONE scheduler owner and ONE writer of canonical live
V2 sessions (2026-09-25 onward). Runs only on the `breadth-v2-runner` service
(`BREADTH_V2_PRODUCER_ENABLED=1`, `api.breadth_v2_producer_main`); never in web or worker.

LIFECYCLE of session D (states in `state.db`, surfaced at `/` on the service):

    EXPECTED    D is a trading day after the last canonical session
    WAITING     not ready: minute file (lands ~04:35Z D+1) or the collector row of the NEXT session
                (the PIT hindsight gate needs it, ~20:15Z D+1) is not there yet — data readiness,
                never the clock, decides
    CHECKING    a fresh one-window vintage is acquired (PIT ledger refresh → acquire_all →
                guard/dividend tables → preflight) and the batch is computed TWICE
    VALIDATED   every gate below passed
    CURRENT     published: canonical store + immutable R2 publication + manifest (web adopts it)
    RETRYING    a transient failure; retried with backoff, publishes nothing meanwhile
    REVIEW_REQUIRED  the PIT gate STOPPED (an unreviewed rejection / a mutated source row) — owner
    FAILED      exhausted retries — withheld, reported

⛔ FAIL CLOSED: a process exit 0 publishes nothing; only a VALIDATED batch is written. An accepted
session is IMMUTABLE — a later rerun that disagrees is recorded as a conflict, never published.
⛔ The frozen artifact is read exactly once (sha-verified, read-only) to extract the ratio priors
for the first live sessions; no routine step opens it again.
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from typing import Optional

from api.services import breadth_authority as ba
from api.services import breadth_vintage_archive as va

ROOT = os.environ.get("BV2_PRODUCER_ROOT", "/data/breadth_v2_producer")
REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
TOOLS = os.path.join(REPO, "tools", "breadth_v2")
# Each default is the literal this module has always resolved on the
# breadth-v2-runner service -- an env override whose default IS that
# literal, so production resolves byte-identically with nothing set, and
# the repo-root census (conftest.py) can pin it for the test suite.
FROZEN_ON_RUNNER = os.environ.get("BV2_FROZEN_FINAL_DIR", "/data/_audit/v2cc/final/") + ba.FROZEN_NAME
SEED_LEDGER = os.environ.get(
    "BV2_SEED_LEDGER_PATH", "/data/_audit/v2cc/inputs_v20260924f/pit_uct_ledger.json")
SEED_GROUPED = os.environ.get("BV2_SEED_GROUPED_DIR", "/data/grouped_closes_v20260924f")
PINNED_UCT = os.environ.get(
    "BV2_PINNED_UCT_SEED_PATH", "/data/_audit/validation/pinned_uct_universe.json")
UNIVERSES = ("uct", "uct_backtest", "us", "nasdaq", "nyse")
PCT = {m for m in ba.V2_METRICS if m.startswith("pct_above_")}
KEEP_VINTAGES = 3
#: ⛔ Exchange Breadth V1's owner-vintage archive. A vintage beyond KEEP_VINTAGES is deleted ONLY after
#: `breadth_vintage_archive.verify` re-proves its archived copy here (see `_prune_vintages`).
EXCH_ARCHIVE_DIR = os.environ.get("BV2_EXCH_ARCHIVE_DIR", "/data/_audit/exch_v1/live_v1/vintage_archive")
MAX_ATTEMPTS = 6
POP_TOLERANCE = 0.20          # universe_count vs the previous canonical session (collapse guard)

EXPECTED, WAITING, CHECKING, VALIDATED, CURRENT = "EXPECTED", "WAITING", "CHECKING", "VALIDATED", "CURRENT"
RETRYING, REVIEW_REQUIRED, FAILED = "RETRYING", "REVIEW_REQUIRED", "FAILED"


def _utc() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _sha_file(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ── stores ────────────────────────────────────────────────────────────────────
def _state() -> sqlite3.Connection:
    os.makedirs(ROOT, exist_ok=True)
    c = sqlite3.connect(os.path.join(ROOT, "state.db"), timeout=30)
    c.executescript("""
        CREATE TABLE IF NOT EXISTS session (date TEXT PRIMARY KEY, state TEXT NOT NULL, attempts INTEGER DEFAULT 0,
            reason TEXT, vintage TEXT, pub_id TEXT, pub_sha256 TEXT, next_try_at TEXT, validation TEXT,
            updated_at TEXT);
        CREATE TABLE IF NOT EXISTS vintage (tag TEXT PRIMARY KEY, last_session TEXT, grouped_dir TEXT,
            inputs_dir TEXT, pit_ledger TEXT, created_at TEXT, state TEXT, report TEXT);
        CREATE TABLE IF NOT EXISTS conflict (date TEXT, offered_sha256 TEXT, accepted_sha256 TEXT, seen_at TEXT);
        CREATE TABLE IF NOT EXISTS event (at TEXT, kind TEXT, detail TEXT);
        CREATE TABLE IF NOT EXISTS prune_guard (tag TEXT PRIMARY KEY, checked_at TEXT, ok INTEGER,
            reason TEXT, detail TEXT, first_blocked_at TEXT);""")
    return c


def _canon() -> sqlite3.Connection:
    """The CANONICAL live V2 store — written only by `_publish`, one accepted row set per session."""
    os.makedirs(ROOT, exist_ok=True)
    c = sqlite3.connect(os.path.join(ROOT, "v2_live.db"), timeout=30)
    c.executescript("""
        CREATE TABLE IF NOT EXISTS v2_session (date TEXT PRIMARY KEY, pub_id TEXT NOT NULL, sha256 TEXT NOT NULL,
            provenance TEXT NOT NULL, published_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS v2_row (universe TEXT, date TEXT, metric TEXT, o REAL, h REAL, l REAL, c REAL,
            source TEXT NOT NULL, pub_id TEXT NOT NULL, PRIMARY KEY (universe, date, metric));""")
    return c


def _event(kind: str, detail) -> None:
    with _state() as c:
        c.execute("INSERT INTO event VALUES(?,?,?)", (_utc(), kind, json.dumps(detail, default=str)[:20000]))
    print("[bv2-producer] %s %s" % (kind, json.dumps(detail, default=str)[:600]), flush=True)


def _set(date: str, state: str, **kw) -> None:
    with _state() as c:
        cur = c.execute("SELECT attempts FROM session WHERE date=?", (date,)).fetchone()
        if cur is None:
            c.execute("INSERT INTO session(date, state, updated_at) VALUES(?,?,?)", (date, state, _utc()))
        sets = {"state": state, "updated_at": _utc(), **kw}
        c.execute("UPDATE session SET %s WHERE date=?" % ",".join("%s=?" % k for k in sets),
                  (*sets.values(), date))


# ── calendar + readiness ─────────────────────────────────────────────────────
def _calendar():
    sys.path.insert(0, os.path.join(TOOLS, "pinned"))
    import breadth_calendar as bcal   # the pinned calendar module, imported standalone (pure rules)
    return bcal


def trading_days(frm: str, to: str) -> list:
    bcal = _calendar()
    d, out = dt.date.fromisoformat(frm), []
    while d.isoformat() <= to:
        if bcal.is_trading_day(d.isoformat()):
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def _next_session(d: str) -> str:
    bcal = _calendar()
    x = dt.date.fromisoformat(d) + dt.timedelta(days=1)
    while not bcal.is_trading_day(x.isoformat()):
        x += dt.timedelta(days=1)
    return x.isoformat()


def _s3():
    import boto3
    return boto3.client("s3", region_name="us-east-1",
                        aws_access_key_id=os.environ.get("MASSIVE_S3_ACCESS_KEY") or os.environ.get("MASSIVE_ACCESS_KEY"),
                        aws_secret_access_key=os.environ.get("MASSIVE_S3_SECRET") or os.environ.get("MASSIVE_SECRET_KEY"),
                        endpoint_url=os.environ.get("MASSIVE_S3_ENDPOINT") or "https://files.massive.com")


def minute_file_ready(d: str) -> bool:
    try:
        _s3().head_object(Bucket="flatfiles", Key="us_stocks_sip/minute_aggs_v1/%s/%s/%s.csv.gz" % (d[:4], d[5:7], d))
        return True
    except Exception:
        return False


def fetch_pit_export() -> dict:
    url = (os.environ.get("DASHBOARD_URL") or "").rstrip("/") + "/api/breadth-monitor/pit-export?since=2026-01-01"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ.get("PUSH_SECRET", ""),
                                               "User-Agent": "uct-breadth-v2-producer"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = json.load(r)
    if not body.get("ok"):
        raise RuntimeError("pit export not ok")
    return body["sessions"]


def ready(d: str, export: dict) -> tuple[bool, str]:
    if d not in export:
        return False, "collector row for %s not stored yet" % d
    nxt = _next_session(d)
    if nxt not in export:
        return False, "PIT hindsight gate needs the next session's collector row (%s)" % nxt
    if not minute_file_ready(d):
        return False, "minute flat file for %s not published yet" % d
    return True, "ready"


# ── canonical history for priors (frozen once, then live) ───────────────────
def frozen_tail() -> dict:
    """{universe: {date: {up_4pct_today, down_4pct_today}}} for the frozen tail — extracted ONCE."""
    p = os.path.join(ROOT, "frozen_tail.json")
    if os.path.exists(p):
        t = json.load(open(p))
        if t.get("frozen_sha256") == ba.FROZEN_SHA256:
            return t
    if _sha_file(FROZEN_ON_RUNNER) != ba.FROZEN_SHA256:
        raise RuntimeError("frozen artifact on the runner does not match the freeze identity")
    c = sqlite3.connect("file:%s?mode=ro&immutable=1" % FROZEN_ON_RUNNER, uri=True)
    rows: dict = {}
    for u, d, m, v in c.execute("SELECT universe,date,metric,c FROM breadth_daily_ohlc WHERE date>='2026-09-01' "
                                "AND metric IN ('up_4pct_today','down_4pct_today','universe_count')"):
        rows.setdefault(u, {}).setdefault(d, {})[m] = v
    c.close()
    t = {"frozen_sha256": ba.FROZEN_SHA256, "extracted_at": _utc(), "rows": rows}
    tmp = p + ".tmp"
    json.dump(t, open(tmp, "w"))
    os.replace(tmp, p)
    return t


def canonical_counts() -> dict:
    """{universe: {date: {metric: close}}} of the up/down/universe_count family: frozen tail + live."""
    out = {u: {d: dict(v) for d, v in byd.items()} for u, byd in frozen_tail()["rows"].items()}
    with _canon() as c:
        for u, d, m, v in c.execute("SELECT universe,date,metric,c FROM v2_row WHERE metric IN "
                                    "('up_4pct_today','down_4pct_today','universe_count')"):
            out.setdefault(u, {}).setdefault(d, {})[m] = v
    return out


def priors_for(first: str, grouped_calendar: list) -> dict:
    import bisect
    i = bisect.bisect_left(grouped_calendar, first)
    prev = grouped_calendar[max(0, i - 9):i]
    cc = canonical_counts()
    return {u: {d: {m: v for m, v in byd[d].items() if m != "universe_count"} for d in prev if d in byd}
            for u, byd in cc.items()}


# ── vintage ──────────────────────────────────────────────────────────────────
def _run_tool(args: list, env_extra: dict, log: str, timeout: int) -> int:
    env = dict(os.environ, PYTHONPATH=REPO, **env_extra)
    with open(log, "a") as lf:
        lf.write("\n== %s %s\n" % (_utc(), " ".join(args)))
        lf.flush()
        return subprocess.run([sys.executable, "-u", os.path.join(TOOLS, "run_overlay.py")] + args,
                              cwd=REPO, env=env, stdout=lf, stderr=subprocess.STDOUT, timeout=timeout).returncode


def _latest_vintage() -> Optional[dict]:
    with _state() as c:
        r = c.execute("SELECT tag, grouped_dir, inputs_dir, pit_ledger FROM vintage WHERE state='ready' "
                      "ORDER BY created_at DESC LIMIT 1").fetchone()
    return dict(zip(("tag", "grouped_dir", "inputs_dir", "pit_ledger"), r)) if r else None


def build_vintage(last: str, export: dict) -> dict:
    """PIT ledger refresh → one-window acquisition → guard/dividend tables. Raises on refusal."""
    tag = "p" + time.strftime("%Y%m%d%H%M", time.gmtime())
    vd = os.path.join(ROOT, "vintages", tag)
    os.makedirs(vd, exist_ok=True)
    log = os.path.join(vd, "vintage.log")
    prev = _latest_vintage()
    prev_ledger = prev["pit_ledger"] if prev else SEED_LEDGER
    cal_seed = prev["grouped_dir"] if prev else SEED_GROUPED
    exp_path = os.path.join(vd, "pit_export.json")
    json.dump(export, open(exp_path, "w"))
    ledger = os.path.join(vd, "pit_uct_ledger.json")
    report = os.path.join(vd, "pit_gate_report.json")
    rc = _run_tool([os.path.join(TOOLS, "pit_ledger_refresh.py"), exp_path, prev_ledger,
                    os.path.join(TOOLS, "pit_reviewed_rejections.json"), ledger, report], {}, log, 900)
    if rc == 2:
        raise ReviewRequired(json.load(open(report)))
    if rc != 0:
        raise RuntimeError("pit_ledger_refresh rc=%s" % rc)
    env = {"BV2_GROUPED_BASE": os.path.join(vd, "grouped_"), "BV2_INPUTS_BASE": os.path.join(vd, "inputs_"),
           "BV2_CAL_SEED_DIR": cal_seed, "BV2_PINNED_UCT": PINNED_UCT}
    rc = _run_tool([os.path.join(TOOLS, "acquire_all.py"), tag, last, ledger], env, log, 5400)
    if rc != 0:
        raise RuntimeError("acquire_all rc=%s" % rc)
    grouped, inputs = os.path.join(vd, "grouped_" + tag), os.path.join(vd, "inputs_" + tag)
    rc = _run_tool([os.path.join(TOOLS, "build_tables.py"), inputs, grouped], {}, log, 3600)
    if rc != 0:
        raise RuntimeError("build_tables rc=%s" % rc)
    with _state() as c:
        c.execute("INSERT INTO vintage VALUES(?,?,?,?,?,?,?,?)",
                  (tag, last, grouped, inputs, ledger, _utc(), "ready", open(report).read()))
    _prune_vintages()
    return {"tag": tag, "grouped_dir": grouped, "inputs_dir": inputs, "pit_ledger": ledger, "dir": vd}


def _owned_provenance(tag: str) -> list:
    """The canonical provenance of every session `tag` published (the archive must hold those inputs)."""
    out = []
    with _canon() as c:
        for d, prov in c.execute("SELECT date, provenance FROM v2_session"):
            p = json.loads(prov)
            if p.get("vintage_tag") == tag:
                out.append({"date": d, "input_manifest_sha256": p.get("input_manifest_sha256"),
                            "reference_sha256": p.get("reference_sha256")})
    return out


def _alarm(severity: str, message: str, detail) -> None:
    """The existing operator alert sink (a CRITICAL pages Discord). Best-effort: never raises."""
    try:
        from api.services import chart_health_alerts as cha
        cha.emit("breadth_v2_prune_guard", severity, message, {"detail": detail})
    except Exception:  # noqa: BLE001
        pass


def _prune_vintages() -> dict:
    """⛔⛔ THE ONE PRUNE DECISION PATH. Every caller (a normal build, a retry's build, any manual call)
    comes through here, and a vintage beyond the newest KEEP_VINTAGES is deleted ONLY when
    `breadth_vintage_archive.verify` re-proves — now, byte for byte — that Exchange Breadth's archive
    holds it (ack present and well-formed, SUMS identity, every archived file, every required producer
    file, and the input/reference identity of every session it published). Anything else — no ack, a
    malformed ack, a mismatch, an unreadable archive, an exception — means NO PRUNE: disk grows and an
    alarm fires; owner evidence never disappears. Publication is NOT coupled to this: a blocked prune
    never fails or delays a session."""
    out = {"pruned": [], "blocked": {}}
    with _state() as c:
        tags = [r[0] for r in c.execute("SELECT tag FROM vintage WHERE state='ready' ORDER BY created_at DESC")]
    for t in tags[KEEP_VINTAGES:]:
        src = os.path.join(ROOT, "vintages", t)
        try:
            va.verify(EXCH_ARCHIVE_DIR, t, src, owned_provenance=_owned_provenance(t))
        except Exception as e:  # noqa: BLE001 — AckRefused or anything unexpected: both mean NO PRUNE
            reason = e.reason if isinstance(e, va.AckRefused) else "GUARD_ERROR"
            detail = e.detail if isinstance(e, va.AckRefused) else "%s: %s" % (type(e).__name__, e)
            out["blocked"][t] = reason
            with _state() as c:
                c.execute("INSERT INTO prune_guard(tag, checked_at, ok, reason, detail, first_blocked_at) "
                          "VALUES(?,?,0,?,?,?) ON CONFLICT(tag) DO UPDATE SET checked_at=excluded.checked_at, "
                          "ok=0, reason=excluded.reason, detail=excluded.detail, "
                          "first_blocked_at=COALESCE(prune_guard.first_blocked_at, excluded.first_blocked_at)",
                          (t, _utc(), reason, json.dumps(detail, default=str)[:4000], _utc()))
            continue
        with _state() as c:
            c.execute("INSERT INTO prune_guard(tag, checked_at, ok, reason, detail, first_blocked_at) "
                      "VALUES(?,?,1,'verified',NULL,NULL) ON CONFLICT(tag) DO UPDATE SET "
                      "checked_at=excluded.checked_at, ok=1, reason='verified', detail=NULL", (t, _utc()))
        shutil.rmtree(src, ignore_errors=True)
        with _state() as c:
            c.execute("UPDATE vintage SET state='pruned' WHERE tag=?", (t,))
        out["pruned"].append(t)
    if out["blocked"]:
        integrity = {t: r for t, r in out["blocked"].items() if r != "ACK_MISSING"}
        _event("prune_blocked", out["blocked"])
        _alarm("critical" if integrity else "warning",
               "Breadth V2 producer: %d vintage(s) NOT pruned — exchange archive not verified: %s"
               % (len(out["blocked"]), ", ".join("%s=%s" % kv for kv in sorted(out["blocked"].items()))),
               out["blocked"])
    if out["pruned"]:
        _event("pruned", out["pruned"])
    return out


def archive_guard_status() -> dict:
    """Machine-readable prune/archive/disk health — CHEAP (no re-hashing; the last full verification
    of each prune candidate is read from `prune_guard`)."""
    now = time.time()
    with _state() as c:
        ready = list(c.execute("SELECT tag, created_at FROM vintage WHERE state='ready' ORDER BY created_at DESC"))
        guard = {r[0]: r[1:] for r in c.execute(
            "SELECT tag, checked_at, ok, reason, first_blocked_at FROM prune_guard")}
    created = dict(ready)
    cands = [t for t, _c in ready[KEEP_VINTAGES:]]
    blocked = {t: (guard[t][2] if t in guard and not guard[t][1] else "NOT_YET_EVALUATED")
               for t in cands if t not in guard or not guard[t][1]}
    integrity = [t for t, r in blocked.items() if r not in ("ACK_MISSING", "NOT_YET_EVALUATED")]
    oldest = min(blocked, key=lambda t: created[t]) if blocked else None
    age_h = None
    if oldest:
        since = (guard.get(oldest) or (None, None, None, None))[3] or created[oldest]
        try:
            age_h = (now - dt.datetime.strptime(since, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=dt.timezone.utc).timestamp()) / 3600.0
        except (TypeError, ValueError):
            age_h = None
    ack_state = {t: va.cheap_state(EXCH_ARCHIVE_DIR, t) for t, _c in ready}
    du = shutil.disk_usage(ROOT if os.path.isdir(ROOT) else ".")
    level, reasons = va.disk_level(du.free, len(blocked), age_h, len(integrity))
    return {"archive_dir": EXCH_ARCHIVE_DIR, "protocol": va.PROTOCOL, "keep_vintages": KEEP_VINTAGES,
            "ready_vintages": [t for t, _c in ready], "prune_candidates": cands,
            "prune_blocked": blocked, "prune_blocked_count": len(blocked), "oldest_prune_blocked": oldest,
            "oldest_prune_blocked_age_hours": round(age_h, 1) if age_h is not None else None,
            "unarchived_ready_vintages": [t for t, s in ack_state.items() if s != "acked"],
            "ack_state": ack_state, "verification_failures": integrity,
            "disk": {"free_bytes": du.free, "total_bytes": du.total,
                     "warn_free_bytes": va.DISK_WARN_FREE_BYTES, "crit_free_bytes": va.DISK_CRIT_FREE_BYTES},
            "level": level, "reasons": reasons}


class ReviewRequired(Exception):
    pass


# ── validation (pure; unit-tested) ───────────────────────────────────────────
def validate_batch(res: dict, accepted_uct: set, prev_counts: dict) -> dict:
    """{date: {"ok": bool, "problems": [...], "absent_by_rule": [...]}} — every gate, fail closed."""
    out = {}
    rows_by = {}
    for u, d, m, o, h, l, c, s in res.get("rows") or []:
        rows_by.setdefault(d, {}).setdefault(u, {})[m] = (o, h, l, c, s)
    if res.get("preflight_problems"):
        return {d: {"ok": False, "problems": ["preflight: %s" % res["preflight_problems"]]} for d in res["dates"]}
    counts = {u: dict(v) for u, v in prev_counts.items()}
    for d in res["dates"]:
        P = []
        if not res.get("determinism"):
            P.append("twin runs disagree (nondeterministic)")
        ck = (res.get("checkpoints") or {}).get(d)
        if not ck or ck[0] != "done":
            P.append("checkpoint %s" % (ck,))
        cal = (res.get("calendar") or {}).get(d) or {}
        sess = (res.get("sessions") or {}).get(d) or {}
        if not cal.get("trading_day") or not cal.get("window"):
            P.append("not a trading day by the calendar")
        else:
            w0, w1 = cal["window"]
            exp_b = w1 - w0 + 1
            if sess.get("expected_buckets") != exp_b:
                P.append("expected buckets %s != calendar %s" % (sess.get("expected_buckets"), exp_b))
            if bool(sess.get("early_close")) != (w1 < 15 * 60):
                P.append("early-close flag disagrees with the calendar")
            for u, b in (sess.get("universe_buckets") or {}).items():
                if b is None or b < exp_b * 0.95:
                    P.append("%s buckets %s < 95%% of %s" % (u, b, exp_b))
        mem = (res.get("members") or {}).get(d) or {}
        byu = rows_by.get(d, {})
        uct_expected = d in accepted_uct
        if uct_expected != ("uct" in mem):
            P.append("uct membership presence %s != PIT ledger %s" % ("uct" in mem, uct_expected))
        if not uct_expected and "uct" in byu:
            P.append("uct rows on a PIT-rejected session")
        absent = {}
        for u in UNIVERSES:
            if u not in mem:
                continue
            got = byu.get(u, {})
            missing = set(ba.V2_METRICS) - set(got)
            ratio_ok_absent = set()
            for m, n in (("ratio_5day", 5), ("ratio_10day", 10)):
                if m in missing and not _window_complete(counts.get(u, {}), d, n, res):
                    ratio_ok_absent.add(m)
            bad_missing = missing - ratio_ok_absent
            if bad_missing:
                P.append("%s missing %s" % (u, sorted(bad_missing)))
            absent[u] = sorted(ratio_ok_absent)
            for m, (o, h, l, c, s) in got.items():
                if s not in ba.V2_SOURCES:
                    P.append("%s %s source %s" % (u, m, s))
                if None in (o, h, l, c) or not (l <= min(o, c) + 1e-9 and h >= max(o, c) - 1e-9):
                    P.append("%s %s ohlc incoherent %s" % (u, m, (o, h, l, c)))
                elif m in PCT and not (-1e-9 <= l and h <= 100 + 1e-9):
                    P.append("%s %s outside 0..100" % (u, m))
            uc = (got.get("universe_count") or (None,) * 4)[3]
            if not uc or uc <= 0:
                P.append("%s universe_count %s" % (u, uc))
            else:
                prevd = max((x for x in counts.get(u, {}) if x < d and counts[u][x].get("universe_count")), default=None)
                if prevd:
                    pv = counts[u][prevd]["universe_count"]
                    if abs(uc - pv) / pv > POP_TOLERANCE:
                        P.append("%s universe_count %s vs %s on %s (> %d%%)" % (u, uc, pv, prevd, POP_TOLERANCE * 100))
            if len(mem[u]) != (sess.get("universe_sizes") or {}).get(u):
                P.append("%s membership size %s != pass size %s" % (u, len(mem[u]), (sess.get("universe_sizes") or {}).get(u)))
            # this session's counts feed the next date's ratio window
            counts.setdefault(u, {})[d] = {m: got[m][3] for m in ("up_4pct_today", "down_4pct_today", "universe_count") if m in got}
        out[d] = {"ok": not P, "problems": P, "absent_by_rule": absent.get("uct", [])}
    return out


def _window_complete(ucounts: dict, d: str, n: int, res: dict) -> bool:
    """Did the pass have all N-1 prior sessions for the ratio? (then an absent ratio is a defect)"""
    cal = res.get("grouped_calendar_tail") or []
    import bisect
    i = bisect.bisect_left(cal, d)
    w = cal[max(0, i - (n - 1)):i]
    return len(w) == n - 1 and all(x in ucounts and "up_4pct_today" in ucounts[x] and "down_4pct_today" in ucounts[x]
                                   for x in w)


# ── publication ──────────────────────────────────────────────────────────────
def build_publication(d: str, res: dict, vintage: dict, validation: dict) -> tuple[bytes, dict]:
    rows = [[u, m, o, h, l, c, s] for (u, dd, m, o, h, l, c, s) in res["rows"] if dd == d]
    mem = res["members"][d]
    msha = dict(res["membership_sha256"][d])
    if "uct" not in mem:
        msha["uct"] = "PIT_REJECTED"
    inputs = vintage["inputs_dir"]
    prov = {"methodology": res["overlay"]["methodology"], "ema_rule": res["overlay"]["ema_rule"],
            "base_methodology": "rth-1m-composites-v2c2-div",
            "producer_version": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "unrecorded"),
            "pinned_modules_md5_lf": res["overlay"]["modules_md5_lf"],
            "vintage_tag": vintage["tag"], "input_manifest_sha256": _sha_file(os.path.join(inputs, "INPUT_MANIFEST.json")),
            "pit_ledger_sha256": _sha_file(os.path.join(inputs, "pit_uct_ledger.json")),
            "reference_sha256": _sha_file(os.path.join(inputs, "pit_reference.json")),
            "guard_input_key": res["meta"].get("guard_input_key"), "dividend_input_key": res["meta"].get("dividend_input_key"),
            "membership_sha256": msha, "membership": mem,
            "session": (res.get("sessions") or {}).get(d), "absent_by_rule": validation["absent_by_rule"],
            "validation": validation, "determinism": res["determinism"], "validated_at": _utc()}
    pub = {"date": d, "pub_id": None, "state": "VALIDATED", "provenance": prov, "rows": rows}
    core = json.dumps({"date": d, "rows": rows, "membership_sha256": msha}, sort_keys=True).encode()
    pub["pub_id"] = "%s-%s-%s" % (d, vintage["tag"], hashlib.sha256(core).hexdigest()[:10])
    blob = gzip.compress(json.dumps(pub, sort_keys=True).encode(), mtime=0)
    return blob, pub


def _r2():
    from api.services import breadth_ohlc_sync as bos
    cl, bk = bos._client(), bos._bucket()
    if not (cl and bk):
        raise RuntimeError("no R2 credentials")
    return cl, bk


def publish(d: str, blob: bytes, pub: dict) -> str:
    """Canonical store first (the authority), then the immutable R2 object, then the manifest."""
    sha = hashlib.sha256(blob).hexdigest()
    with _canon() as c:
        cur = c.execute("SELECT sha256 FROM v2_session WHERE date=?", (d,)).fetchone()
        if cur is not None and cur[0] != sha:
            with _state() as s:
                s.execute("INSERT INTO conflict VALUES(?,?,?,?)", (d, sha, cur[0], _utc()))
            raise RuntimeError("session %s already accepted with a different publication — not republished" % d)
        if cur is None:
            c.execute("INSERT INTO v2_session VALUES(?,?,?,?,?)",
                      (d, pub["pub_id"], sha, json.dumps(pub["provenance"], sort_keys=True), _utc()))
            c.executemany("INSERT INTO v2_row VALUES(?,?,?,?,?,?,?,?,?)",
                          [(u, d, m, o, h, l, cl, s, pub["pub_id"]) for (u, m, o, h, l, cl, s) in pub["rows"]])
    cl, bk = _r2()
    key = "%ssessions/%s/%s.json.gz" % (ba._R2_LIVE_PREFIX, d, pub["pub_id"])
    cl.put_object(Bucket=bk, Key=key, Body=blob, ContentType="application/gzip")
    if hashlib.sha256(cl.get_object(Bucket=bk, Key=key)["Body"].read()).hexdigest() != sha:
        raise RuntimeError("R2 read-back mismatch for %s" % key)
    try:
        man = json.loads(cl.get_object(Bucket=bk, Key=ba._R2_MANIFEST)["Body"].read())
    except Exception:
        man = {"sessions": {}}
    old = (man.get("sessions") or {}).get(d)
    if old and old.get("sha256") != sha:
        raise RuntimeError("manifest already names a different publication for %s" % d)
    man.setdefault("sessions", {})[d] = {"key": key, "sha256": sha, "pub_id": pub["pub_id"], "state": "VALIDATED",
                                         "validated_at": pub["provenance"]["validated_at"]}
    man.update(updated_at=_utc(), producer_version=pub["provenance"]["producer_version"],
               methodology=pub["provenance"]["methodology"])
    body = json.dumps(man, sort_keys=True, indent=1).encode()
    cl.put_object(Bucket=bk, Key=ba._R2_MANIFEST, Body=body, ContentType="application/json")
    if cl.get_object(Bucket=bk, Key=ba._R2_MANIFEST)["Body"].read() != body:
        raise RuntimeError("manifest read-back mismatch")
    return sha


# ── one tick ─────────────────────────────────────────────────────────────────
def pending_targets(today_et: str) -> list:
    days = trading_days(ba.LIVE_START, today_et)
    days = [d for d in days if d < today_et]           # a session is producible only after it completes
    with _canon() as c:
        done = {r[0] for r in c.execute("SELECT date FROM v2_session")}
    with _state() as s:
        st = dict(s.execute("SELECT date, state FROM session"))
    return [d for d in days if d not in done and st.get(d) not in (REVIEW_REQUIRED, FAILED)]


def tick(now: Optional[dt.datetime] = None) -> dict:
    from zoneinfo import ZoneInfo
    now = now or dt.datetime.now(dt.timezone.utc)
    today_et = now.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    targets = pending_targets(today_et)
    if not targets:
        return {"idle": True}
    for d in targets:
        with _state() as s:
            r = s.execute("SELECT state, next_try_at FROM session WHERE date=?", (d,)).fetchone()
        if r is None:
            _set(d, EXPECTED)
        elif r[1] and r[1] > _utc():
            return {"backoff": d, "until": r[1]}
    export = fetch_pit_export()
    batch = []
    for d in targets:                                   # in order: ratios need the previous session
        ok, why = ready(d, export)
        if not ok:
            _set(d, WAITING, reason=why)
            break
        batch.append(d)
    if not batch:
        return {"waiting": targets[0]}
    for d in batch:
        _set(d, CHECKING, reason="vintage + compute")
    try:
        vintage = build_vintage(batch[-1], export)
        res = compute(batch, vintage)
    except ReviewRequired as e:
        for d in batch:
            _set(d, REVIEW_REQUIRED, reason=json.dumps(e.args[0])[:4000])
        _event("review_required", e.args[0])
        return {"review_required": batch}
    except Exception as e:
        return _retry(batch, "%s: %s" % (type(e).__name__, e))
    ledger = json.load(open(vintage["pit_ledger"]))
    val = validate_batch(res, set(ledger["dates"]), canonical_counts())
    published = []
    for d in batch:
        v = val[d]
        if not v["ok"]:
            _retry(batch[batch.index(d):], "validation: %s" % v["problems"][:6], validation=v)
            break
        _set(d, VALIDATED, validation=json.dumps(v), vintage=vintage["tag"])
        blob, pub = build_publication(d, res, vintage, v)
        try:
            sha = publish(d, blob, pub)
        except Exception as e:
            _retry(batch[batch.index(d):], "publish: %s: %s" % (type(e).__name__, e))
            break
        _set(d, CURRENT, pub_id=pub["pub_id"], pub_sha256=sha, reason=None, next_try_at=None)
        _event("published", {"date": d, "pub_id": pub["pub_id"], "sha256": sha})
        published.append(d)
    return {"published": published, "batch": batch, "vintage": vintage["tag"]}


def compute(batch: list, vintage: dict) -> dict:
    cal = sorted(f[:-7] for f in os.listdir(vintage["grouped_dir"]) if f.endswith("_1.json"))
    pri = priors_for(batch[0], cal)
    wd = os.path.join(vintage["dir"], "work")
    os.makedirs(wd, exist_ok=True)
    pj, oj = os.path.join(wd, "priors.json"), os.path.join(wd, "out.json")
    json.dump(pri, open(pj, "w"))
    rc = _run_tool([os.path.join(TOOLS, "produce_sessions.py"), vintage["inputs_dir"], vintage["grouped_dir"],
                    ",".join(batch), pj, oj, wd], {}, os.path.join(vintage["dir"], "compute.log"), 7200)
    if not os.path.exists(oj):
        raise RuntimeError("produce_sessions rc=%s, no output" % rc)
    res = json.load(open(oj))
    res["grouped_calendar_tail"] = cal[-40:]
    if rc != 0:
        res.setdefault("preflight_problems", ["produce_sessions rc=%s" % rc])
    return res


def _retry(dates: list, reason: str, validation: Optional[dict] = None) -> dict:
    with _state() as s:
        for d in dates:
            r = s.execute("SELECT attempts FROM session WHERE date=?", (d,)).fetchone()
            n = (r[0] if r else 0) + 1
            state = FAILED if n >= MAX_ATTEMPTS else RETRYING
            nxt = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + min(3600 * 6, 600 * 2 ** n)))
            s.execute("INSERT OR IGNORE INTO session(date, state) VALUES(?,?)", (d, state))
            s.execute("UPDATE session SET state=?, attempts=?, reason=?, next_try_at=?, validation=?, updated_at=? "
                      "WHERE date=?", (state, n, reason[:4000], nxt, json.dumps(validation) if validation else None,
                                       _utc(), d))
    _event("retry", {"dates": dates, "reason": reason[:1000]})
    return {"retrying": dates, "reason": reason}


def status() -> dict:
    with _state() as s:
        sessions = [dict(zip(("date", "state", "attempts", "reason", "vintage", "pub_id", "pub_sha256", "next_try_at",
                              "updated_at"), r)) for r in s.execute(
            "SELECT date,state,attempts,reason,vintage,pub_id,pub_sha256,next_try_at,updated_at FROM session ORDER BY date")]
        events = s.execute("SELECT at, kind, substr(detail,1,400) FROM event ORDER BY at DESC LIMIT 12").fetchall()
        conflicts = s.execute("SELECT * FROM conflict").fetchall()
    with _canon() as c:
        canon = c.execute("SELECT COUNT(*), MAX(date) FROM v2_session").fetchone()
    return {"role": "breadth-v2-producer (the ONE writer of canonical live V2)", "sessions": sessions,
            "canonical_sessions": canon[0], "latest_canonical": canon[1], "events": events, "conflicts": conflicts,
            "hold": os.path.exists(os.path.join(ROOT, "HOLD")), "archive_guard": _guard_status_safe(),
            "updated_at": _utc()}


def _guard_status_safe() -> dict:
    try:
        return archive_guard_status()
    except Exception as e:  # noqa: BLE001 — a status page never fails on its health block
        return {"level": "CRITICAL", "reasons": ["archive guard status error: %s: %s" % (type(e).__name__, e)]}


def singleton_lock():
    import fcntl                       # the runner is Linux; imported here so tests run anywhere
    os.makedirs(ROOT, exist_ok=True)
    f = open(os.path.join(ROOT, "producer.lock"), "w")
    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    f.write(str(os.getpid()))
    f.flush()
    return f
