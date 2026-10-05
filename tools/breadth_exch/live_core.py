"""Exchange Breadth V1 — LIVE LEG core (pure; no api.services imports; unit-tested).

    FROZEN HISTORY → ACCEPTED IDENTITY → LIVE EVIDENCE → LIVE SESSION COMPUTATION
                   → DERIVED CONTINUATION → VALIDATED LIVE CANDIDATE

STABLE IDENTITY tells us which security this is (identity_model.Bridge / IdentityState).
SESSION-DATED VENUE EVIDENCE tells us where it belonged (the frozen ledger through its last session;
the live evidence extension after it — same classify() rule table, probed every session).
FIRST-CONTAINING VINTAGE tells us what could have been known for that session (owner_vintage).
None of these is ever replaced by the latest mutable reference snapshot.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from typing import Optional

NYSE, NASDAQ, OTHER, UNRESOLVED, CONFLICT = "NYSE", "NASDAQ", "OTHER", "UNRESOLVED", "CONFLICT"
EXCHANGE = (NYSE, NASDAQ)
ALPHA_FAST, ALPHA_SLOW, BURN_IN = 0.10, 0.05, 120


class Refused(Exception):
    """A fail-closed refusal: `reason` is a stable code, `detail` the evidence. The append STOPS."""

    def __init__(self, reason: str, detail=None):
        super().__init__(reason)
        self.reason, self.detail = reason, detail


def sha_file(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ── 1. FIRST-CONTAINING (OWNER) VINTAGE ───────────────────────────────────────────────────────
def owner_vintage(session: str, prod_sessions: dict, prod_pubs: dict, archive_dir: str,
                  verify_files: bool = True) -> dict:
    """The vintage that FIRST CONTAINED `session` = the vintage the production US V2 producer
    validated and published it from (its own record, state.db `session.vintage`, cross-checked
    against the publication's provenance in v2_live.db). Never "latest", never directory order.

    prod_sessions: {date: (state, vintage, pub_id)};  prod_pubs: {date: (pub_id, provenance_dict)}.
    Refuses (fail closed, the append stops) with one of:
      NOT_YET_PUBLISHED     US V2 has not published the session (exchange waits for US V2)
      PROVENANCE_MISSING    no publication provenance for a CURRENT session
      PROVENANCE_INCONSISTENT  state.db vintage / pub_id / provenance disagree (incl. two owners)
      OWNER_VINTAGE_MISSING the owner vintage is not in the exchange archive (e.g. pruned before it
                            was archived) — NEVER falls forward to a newer vintage
      ARCHIVE_INTEGRITY     archived files differ from the archive's SHA256SUMS
      PROVENANCE_MISMATCH   archived INPUT_MANIFEST / reference bytes ≠ the published provenance hashes
    """
    st = prod_sessions.get(session)
    if st is None or st[0] != "CURRENT":
        raise Refused("NOT_YET_PUBLISHED", {"session": session, "producer_state": st})
    pub = prod_pubs.get(session)
    if pub is None:
        raise Refused("PROVENANCE_MISSING", {"session": session})
    state, tag, pub_id = st
    pid, prov = pub
    if pid != pub_id or prov.get("vintage_tag") != tag or not pub_id.startswith(f"{session}-{tag}-"):
        raise Refused("PROVENANCE_INCONSISTENT", {"session": session, "state_vintage": tag, "state_pub_id": pub_id,
                                                  "pub_id": pid, "prov_vintage": prov.get("vintage_tag")})
    want = {"input_manifest_sha256": prov.get("input_manifest_sha256"), "reference_sha256": prov.get("reference_sha256")}
    vd = os.path.join(archive_dir, tag)
    sums = os.path.join(archive_dir, tag + ".SHA256SUMS")
    if not (os.path.isdir(vd) and os.path.exists(sums)):
        raise Refused("OWNER_VINTAGE_MISSING", {"session": session, "owner_vintage": tag, "published_provenance": want,
                                                "pub_id": pub_id})
    inputs, grouped = os.path.join(vd, "inputs_" + tag), os.path.join(vd, "grouped_" + tag)
    got = {"input_manifest_sha256": sha_file(os.path.join(inputs, "INPUT_MANIFEST.json")),
           "reference_sha256": sha_file(os.path.join(inputs, "pit_reference.json"))}
    if got != want:
        raise Refused("PROVENANCE_MISMATCH", {"session": session, "owner_vintage": tag, "archived": got, "published": want})
    if verify_files:
        bad = []
        for line in open(sums):
            h, rel = line.rstrip("\n").split("  ", 1)
            if sha_file(os.path.join(vd, rel)) != h:
                bad.append(rel)
        if bad:
            raise Refused("ARCHIVE_INTEGRITY", {"owner_vintage": tag, "bad": bad[:5], "n_bad": len(bad)})
    return {"session": session, "tag": tag, "pub_id": pub_id, "inputs_dir": inputs, "grouped_dir": grouped,
            "dir": vd, "archive_sums_sha256": sha_file(sums), **want}


# ── 2. MEMBERSHIP: identity bridge (frozen evidence) or live evidence ─────────────────────────
def membership_status(ticker: str, session: str, bridge, ledger_end: str, live: Optional[dict]) -> tuple:
    """(sid, evidence_key, status, source) for one US member on one session.
    Through the frozen ledger's last session → identity_model.Bridge (accepted rows of the ticker's
    holder SID). After it → the session's live evidence for this ticker; absent evidence → UNRESOLVED.
    The vintage's own `ticker|delisted_utc` is NOT an input."""
    if session <= ledger_end:
        sid, key, st = bridge.status(ticker, session)
        return sid, key, st, "ledger"
    ev = (live or {}).get(ticker)
    sid = bridge.sid(ticker, session)
    if ev is None:
        return sid, None, UNRESOLVED, "live:no_evidence"
    return sid, "live:%s" % session, ev["status"], "live:" + ev["source"]


def partition(us: list, statuses: dict, session: str, nyse_start: str, nasdaq_start: str) -> tuple:
    """(nyse, nasdaq, counts) — ONLY NYSE / NASDAQ statuses enter an exchange."""
    c = {"us": len(us), NYSE: 0, NASDAQ: 0, OTHER: 0, UNRESOLVED: 0, CONFLICT: 0, "absent": 0}
    ny, na = [], []
    for t in us:
        st = statuses[t]
        c[st if st in c else "absent"] += 1
        if st == NYSE and session >= nyse_start:
            ny.append(t)
        elif st == NASDAQ and session >= nasdaq_start:
            na.append(t)
    return ny, na, c


# ── 3. DERIVED CONTINUATION (locked methodology; bit-exact with market_indicators.mcclellan) ──
def derive_step(state: dict, adv: Optional[float], dec: Optional[float]) -> tuple[dict, dict]:
    """One session on top of `state` = {ad, ema_fast, ema_slow, valid_obs, mcs, mcs_epoch}.
    adline-v1 (holes hold), ratio-adjusted R=(A-D)/(A+D)*1000 (unchanged excluded), .10/.05, zero
    seed, MCO published from the 121st valid observation, MCS base 0 at the MCO first publish."""
    s = dict(state)
    out = {"AD": None, "MCO": None, "MCS": None}
    if adv is None or dec is None:
        out["AD"] = s["ad"]
        out["MCS"] = s["mcs"]
        return s, out
    s["ad"] = (s["ad"] if s["ad"] is not None else 0.0) + (float(adv) - float(dec))
    out["AD"] = s["ad"]
    if float(adv) + float(dec) <= 0:              # zero denominator: a hole for the trends
        out["MCS"] = s["mcs"]
        return s, out
    x = (float(adv) - float(dec)) / (float(adv) + float(dec)) * 1000.0
    if s["ema_fast"] is None:
        s["ema_fast"] = (1.0 - ALPHA_FAST) * 0.0 + ALPHA_FAST * x
        s["ema_slow"] = (1.0 - ALPHA_SLOW) * 0.0 + ALPHA_SLOW * x
    else:
        s["ema_fast"] = (1.0 - ALPHA_FAST) * s["ema_fast"] + ALPHA_FAST * x
        s["ema_slow"] = (1.0 - ALPHA_SLOW) * s["ema_slow"] + ALPHA_SLOW * x
    s["valid_obs"] += 1
    osc = s["ema_fast"] - s["ema_slow"]
    if s["valid_obs"] > BURN_IN:
        out["MCO"] = osc
        if s["mcs"] is None:                      # the declared epoch: base 0, own MCO not added
            s["mcs"] = 0.0
        else:
            s["mcs"] = s["mcs"] + osc
        out["MCS"] = s["mcs"]
    return s, out


# ── 4. THE ISOLATED CANDIDATE STORE ───────────────────────────────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS lineage (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS live_session (date TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, vintage TEXT NOT NULL,
    input_manifest_sha256 TEXT NOT NULL, reference_sha256 TEXT NOT NULL, us_v2_pub_id TEXT NOT NULL,
    venue_source TEXT NOT NULL, rows INTEGER NOT NULL, rows_sha256 TEXT NOT NULL, membership_sha256 TEXT NOT NULL,
    derived_sha256 TEXT NOT NULL, identity_state_sha256 TEXT NOT NULL, provenance TEXT NOT NULL, completed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS breadth_daily_ohlc (universe TEXT, date TEXT, metric TEXT, o REAL, h REAL, l REAL, c REAL,
    source TEXT NOT NULL, PRIMARY KEY (universe, date, metric));
CREATE TABLE IF NOT EXISTS exch_session (date TEXT PRIMARY KEY, counts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS membership (date TEXT, ticker TEXT, sid TEXT, status TEXT NOT NULL, source TEXT NOT NULL,
    evidence_key TEXT, PRIMARY KEY (date, ticker));
CREATE TABLE IF NOT EXISTS venue_evidence (date TEXT, ticker TEXT, sid TEXT, dated_class TEXT, dated_mic TEXT, tape INTEGER,
    status TEXT NOT NULL, mic TEXT, source TEXT NOT NULL, PRIMARY KEY (date, ticker));
CREATE TABLE IF NOT EXISTS derived_series (series TEXT, date TEXT, value REAL, PRIMARY KEY (series, date));
CREATE TABLE IF NOT EXISTS trend_state (exchange TEXT, date TEXT, ad REAL, ema_fast REAL, ema_slow REAL,
    valid_obs INTEGER NOT NULL, mcs REAL, PRIMARY KEY (exchange, date));
"""
CONTENT_TABLES = ("breadth_daily_ohlc", "exch_session", "membership", "venue_evidence", "derived_series", "trend_state")


class Store:
    """Append-only, one atomic transaction per session; `live_session` is the completion marker and
    is written LAST in that transaction, so a crash can never expose a partial session."""

    def __init__(self, path: str):
        self.path = path
        self.c = sqlite3.connect(path, timeout=60, isolation_level=None)
        self.c.execute("PRAGMA journal_mode=DELETE")
        self.c.executescript(SCHEMA)

    def lineage(self) -> dict:
        return dict(self.c.execute("SELECT key, value FROM lineage"))

    def init_lineage(self, items: dict) -> None:
        cur = self.lineage()
        if cur:
            if {k: cur.get(k) for k in items} != {k: str(v) for k, v in items.items()}:
                raise Refused("LINEAGE_MISMATCH", {"stored": cur, "offered": items})
            return
        self.c.execute("BEGIN IMMEDIATE")
        self.c.executemany("INSERT INTO lineage VALUES(?,?)", [(k, str(v)) for k, v in sorted(items.items())])
        self.c.execute("COMMIT")

    def completed(self) -> list:
        return [r[0] for r in self.c.execute("SELECT date FROM live_session ORDER BY seq")]

    def last_state(self, exchange: str, boundary: dict) -> dict:
        r = self.c.execute("SELECT ad, ema_fast, ema_slow, valid_obs, mcs FROM trend_state WHERE exchange=? "
                           "ORDER BY date DESC LIMIT 1", (exchange,)).fetchone()
        if r is None:
            return dict(boundary)
        return {"ad": r[0], "ema_fast": r[1], "ema_slow": r[2], "valid_obs": r[3], "mcs": r[4]}

    def commit_session(self, date: str, expected_date: str, payload: dict, crash=None) -> None:
        if date != expected_date:
            raise Refused("SEQUENCE", {"offered": date, "expected": expected_date})
        c = self.c
        c.execute("BEGIN IMMEDIATE")
        try:
            if c.execute("SELECT 1 FROM live_session WHERE date=?", (date,)).fetchone():
                raise Refused("ALREADY_COMPLETE", date)
            for t in CONTENT_TABLES:                          # a crashed earlier attempt left nothing (atomic),
                c.execute(f"DELETE FROM {t} WHERE date=?", (date,))   # but be explicit and idempotent
            c.executemany("INSERT INTO breadth_daily_ohlc VALUES(?,?,?,?,?,?,?,?)", payload["rows"])
            if crash:
                crash("during_rows")
            c.execute("INSERT INTO exch_session VALUES(?,?)", (date, json.dumps(payload["counts"], sort_keys=True)))
            c.executemany("INSERT INTO membership VALUES(?,?,?,?,?,?)", payload["membership"])
            c.executemany("INSERT INTO venue_evidence VALUES(?,?,?,?,?,?,?,?,?)", payload.get("evidence", []))
            if crash:
                crash("before_derived")
            c.executemany("INSERT INTO derived_series VALUES(?,?,?)", payload["derived"])
            c.executemany("INSERT INTO trend_state VALUES(?,?,?,?,?,?,?)", payload["trend"])
            if crash:
                crash("after_rows_before_marker")
            seq = (c.execute("SELECT COALESCE(MAX(seq), 0) FROM live_session").fetchone()[0]) + 1
            c.execute("INSERT INTO live_session VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (date, seq, payload["vintage"], payload["input_manifest_sha256"], payload["reference_sha256"],
                       payload["us_v2_pub_id"], payload["venue_source"], len(payload["rows"]), payload["rows_sha256"],
                       payload["membership_sha256"], payload["derived_sha256"], payload["identity_state_sha256"],
                       json.dumps(payload["provenance"], sort_keys=True), payload["completed_at"]))
            c.execute("COMMIT")
        except BaseException:
            try:
                c.execute("ROLLBACK")
            except sqlite3.OperationalError:
                pass
            raise

    def logical_sha256(self) -> str:
        """Content hash of everything except timestamps (completed_at)."""
        h = hashlib.sha256()
        for t in ("lineage",) + CONTENT_TABLES:
            n = len(self.c.execute(f"PRAGMA table_info({t})").fetchall())
            for r in self.c.execute(f"SELECT * FROM {t} ORDER BY " + ", ".join(str(i + 1) for i in range(n))):
                h.update(json.dumps([t, list(r)], default=str).encode())
        for r in self.c.execute("SELECT date, seq, vintage, input_manifest_sha256, reference_sha256, us_v2_pub_id, "
                                "venue_source, rows, rows_sha256, membership_sha256, derived_sha256, "
                                "identity_state_sha256, provenance FROM live_session ORDER BY seq"):
            h.update(json.dumps(["live_session", list(r)], default=str).encode())
        return h.hexdigest()


def rows_sha(rows: list) -> str:
    return hashlib.sha256(json.dumps(sorted([list(r) for r in rows]), default=str).encode()).hexdigest()


# ── 5. ARCHIVE → COMPUTE PATH REMAP (explicit, verified; provenance stays on the archived bytes) ──
PRODUCER_VINTAGES = "/data/breadth_v2_producer/vintages"
REMAP_TABLES = ("adjusted_guard_table.json", "dividend_basis_table.json", "first_raw_session.json")


def _json_diff(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            out += _json_diff(a.get(k), b.get(k), f"{path}.{k}" if path else k)
        return out
    return [] if a == b else [path]


def build_remap(archive_dir: str, tag: str, remap_root: str, producer_root: str = PRODUCER_VINTAGES) -> dict:
    """The engine requires the vintage manifest's grouped `dir` to equal BREADTH_GROUPED_DIR, and the
    producer path will be pruned. A COPY of the archived inputs is rewritten in EXACTLY three places —
    grouped_vintage_manifest.dir, INPUT_MANIFEST.grouped_dir, and INPUT_MANIFEST's object hash for the
    rewritten manifest — and nothing else (verified by a JSON diff). The grouped files are read from the
    read-only archive. Provenance is verified on the ORIGINAL archived bytes (owner_vintage)."""
    import fcntl
    import shutil
    src = os.path.join(archive_dir, tag, "inputs_" + tag)
    dst = os.path.join(remap_root, tag, "inputs_" + tag)
    rep_path = os.path.join(remap_root, tag, "REMAP.json")
    os.makedirs(os.path.join(remap_root, tag), exist_ok=True)
    lk = open(os.path.join(remap_root, tag, ".lock"), "w")
    fcntl.flock(lk, fcntl.LOCK_EX)
    if os.path.exists(rep_path):
        return json.load(open(rep_path))
    old_g = os.path.join(producer_root, tag, "grouped_" + tag)
    new_g = os.path.join(archive_dir, tag, "grouped_" + tag)
    part = dst + ".partial"
    if os.path.exists(part):
        shutil.rmtree(part)
    os.makedirs(part)
    for fn in sorted(os.listdir(src)):
        shutil.copyfile(os.path.join(src, fn), os.path.join(part, fn))
    gb = open(os.path.join(src, "grouped_vintage_manifest.json"), "rb").read()
    mb = open(os.path.join(src, "INPUT_MANIFEST.json"), "rb").read()
    o, n = json.dumps(old_g).encode(), json.dumps(new_g).encode()
    if gb.count(o) != 1 or mb.count(o) != 1:
        raise Refused("REMAP_SHAPE", {"tag": tag, "grouped_manifest_hits": gb.count(o), "input_manifest_hits": mb.count(o)})
    gb2 = gb.replace(o, n)
    oh, nh = hashlib.sha256(gb).hexdigest().encode(), hashlib.sha256(gb2).hexdigest().encode()
    if mb.count(oh) != 1:
        raise Refused("REMAP_SHAPE", {"tag": tag, "manifest_hash_hits": mb.count(oh)})
    mb2 = mb.replace(o, n).replace(oh, nh)
    open(os.path.join(part, "grouped_vintage_manifest.json"), "wb").write(gb2)
    open(os.path.join(part, "INPUT_MANIFEST.json"), "wb").write(mb2)
    d1 = _json_diff(json.loads(gb), json.loads(gb2))
    d2 = _json_diff(json.loads(mb), json.loads(mb2))
    if d1 != ["dir"] or d2 != ["grouped_dir", "objects_sha256.grouped_vintage_manifest.json"]:
        raise Refused("REMAP_DIFF", {"tag": tag, "grouped_manifest": d1, "input_manifest": d2})
    os.replace(part, dst)
    rep = {"tag": tag, "remap_inputs_dir": dst, "grouped_dir": new_g, "replaced_path": [old_g, new_g],
           "changed_fields": {"grouped_vintage_manifest.json": d1, "INPUT_MANIFEST.json": d2},
           "original_sha256": {"INPUT_MANIFEST.json": hashlib.sha256(mb).hexdigest(),
                               "grouped_vintage_manifest.json": hashlib.sha256(gb).hexdigest()},
           "remapped_sha256": {"INPUT_MANIFEST.json": hashlib.sha256(mb2).hexdigest(),
                               "grouped_vintage_manifest.json": hashlib.sha256(gb2).hexdigest()}}
    json.dump(rep, open(rep_path, "w"), indent=1, sort_keys=True)
    return rep


def tables_equivalent(archive_inputs: str, remap_inputs: str, replaced_path=None) -> dict:
    """The tables the engine rebuilt under the remap must equal the producer's own archived tables in
    everything but their CACHE KEY: `input_key` (guard / dividend basis: hashes the manifest file bytes)
    and `identity` (first_raw_session: the grouped calendar identity, which embeds the grouped path —
    it must differ ONLY by the exact remapped path)."""
    out = {}
    for fn in REMAP_TABLES:
        a, b = os.path.join(archive_inputs, fn), os.path.join(remap_inputs, fn)
        if not os.path.exists(a):
            out[fn] = "absent in archive"
            continue
        ja, jb = json.load(open(a)), json.load(open(b))
        if isinstance(ja, dict) and isinstance(jb, dict):
            ja.pop("input_key", None)
            jb.pop("input_key", None)
            if "identity" in ja or "identity" in jb:
                ia, ib = ja.pop("identity", None), jb.pop("identity", None)
                if ia != ib:
                    if not (replaced_path and isinstance(ia, str) and ia.count(replaced_path[0]) >= 1
                            and ia.replace(replaced_path[0], replaced_path[1]) == ib):
                        out[fn] = "DIFFERENT (identity beyond the path remap)"
                        continue
        out[fn] = "equal" if ja == jb else "DIFFERENT"
    return out


# ── 6. VINTAGE ARCHIVAL (the producer keeps only its 3 newest vintages) ───────────────────────────
def archive_vintages(producer_root: str, ready_tags: list, archive_dir: str) -> dict:
    """Copy every READY producer vintage not yet archived into the exchange archive, verified file-by-file
    against the producer's copy, then made read-only. Append-only: an archived vintage is never rewritten.
    ⚠ The live leg must run at least once per (KEEP_VINTAGES - 1) producer publications, or an owner
    vintage can be pruned before it is archived (that is exactly how p202609292209 was lost)."""
    import shutil
    import stat
    out = {}
    os.makedirs(archive_dir, exist_ok=True)
    for tag in sorted(ready_tags):
        dst, sums = os.path.join(archive_dir, tag), os.path.join(archive_dir, tag + ".SHA256SUMS")
        if os.path.isdir(dst) and os.path.exists(sums):
            out[tag] = "already archived"
            continue
        src = os.path.join(producer_root, tag)
        if not os.path.isdir(src):
            out[tag] = "MISSING at producer (pruned before archival)"
            continue
        part = dst + ".partial"
        if os.path.exists(part):
            shutil.rmtree(part)
        shutil.copytree(src, part)
        lines = []
        for root, _dirs, files in os.walk(part):
            for fn in files:
                rel = "./" + os.path.relpath(os.path.join(root, fn), part).replace(os.sep, "/")
                lines.append((rel, sha_file(os.path.join(root, fn))))
        lines.sort()
        for rel, h in lines:
            if sha_file(os.path.join(src, rel)) != h:
                shutil.rmtree(part)
                raise Refused("ARCHIVE_COPY_MISMATCH", {"tag": tag, "file": rel})
        with open(sums + ".tmp", "w") as f:
            for rel, h in lines:
                f.write("%s  %s\n" % (h, rel))
        os.replace(part, dst)
        os.replace(sums + ".tmp", sums)
        for root, dirs, files in os.walk(dst):
            for fn in files:
                os.chmod(os.path.join(root, fn), stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        os.chmod(sums, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
        out[tag] = "archived"
    return out
