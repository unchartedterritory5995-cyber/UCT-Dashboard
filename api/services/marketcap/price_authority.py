"""Market Cap V1 PRICE INPUT AUTHORITY (owner decision 2026-10-05, Option 1).

Market Cap = PRICE x PIT SHARE STATE. The share side is historically deterministic; production bars.db is NOT (since
M3's 2026-09-30 export it lost 39,987 rows on 37 tickers, gained ~2M pre-2006 rows on 660, re-based ~900 histories and
repaired ~2,586 partial September bars). So Market Cap owns its price input: a SEALED, VERSIONED, APPEND-ONLY-BY-DEFAULT
lineage, and an ordinary refresh never inherits an upstream historical rewrite.

STORE  <root>/prices/versions/<version_id>/   every file write-once and read-only (0444)
    manifest.json   kind ROOT | APPEND | HISTORICAL_CORRECTION, parent, file / content hashes, counts, session range,
                    provenance, code, validation
    base.db         ROOT and HISTORICAL_CORRECTION: a complete prices.py-schema snapshot
    delta.db        APPEND: the appended rows (stored on the ROOT's split basis), basis events, per-ticker holds
    APPROVAL.json   HISTORICAL_CORRECTION only: the human approval (written by `approve`, never by a refresh)

MATERIALIZE  base of the nearest ROOT / approved CORRECTION ancestor + every APPEND delta after it, rows INSERTED
(never replaced), then basis events applied -> the build's prices.db. Its content hash is recorded at seal time and
re-verified on every materialization, so a build input is provably the sealed version.

APPEND INVARIANT  a child contains every parent (ticker, session) key with the same stored value; appended keys are all
dated AFTER the parent's last session. changed = removed = historically-inserted = 0, enforced structurally (deltas are
separate immutable files; INSERT without replace) and verified on seal.

NEW SESSIONS  only completed sessions (NYSE calendar; due by currentness.expected_session, no lookahead) that the
OFFICIAL daily aggregate (Massive grouped daily) confirms: a bars.db row whose close differs from it is partial / not
final and is not appended (the ticker is held for that session). A session without its official aggregate, or whose
population collapses, HOLDS the append there (PRICE_HOLD): no price is ever manufactured.

BASIS  bars.db is split-adjusted to today's basis and the builder normalizes shares to the price basis through its
split ledger, so a split AFTER the root must reach the build input on the new basis. Per ticker the upstream source is
anchored on the parent's last <= 5 stored sessions:
    SAME_BASIS        >= 4 of 5 ratios == 1 (a repaired partial last bar is tolerated, not inherited)
    BASIS_EVENT       every ratio == r != 1 AND the reference records a split with that exact factor executed after the
                      anchor: a recorded, versioned basis event (stored observations never change; materialization
                      applies the factor to earlier rows, which leaves Market Cap invariant: price/k x shares*k)
    otherwise         HOLD the ticker (PRICE_BASIS_DIVERGENCE): nothing appended, divergence recorded
HISTORICAL CORRECTIONS are a separate, explicit, human-approved path (`propose_correction` + `approve`); a scheduled
refresh can never create or use an unapproved one.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import stat
import subprocess
import tempfile
from datetime import date, datetime, timezone

FORMAT = 1
KINDS = ("ROOT", "APPEND", "HISTORICAL_CORRECTION")
ANCHOR_DAYS = 5
POPULATION_FLOOR = 0.90          # a session with < 90% of the parent's last-session population is not complete
INVALID_ROW_CEILING = 0.01        # > 1% invalid rows in a session = the session is not trustworthy
DDL = """
CREATE TABLE IF NOT EXISTS bar(ticker TEXT, d INTEGER, c REAL, v REAL, PRIMARY KEY(ticker, d)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS input_file(name TEXT PRIMARY KEY, sha256 TEXT, size INTEGER);
"""
DELTA_DDL = DDL + """
CREATE TABLE IF NOT EXISTS basis_event(ticker TEXT, effective TEXT, factor REAL, anchor_ratio REAL, split TEXT,
  PRIMARY KEY(ticker, effective));
CREATE TABLE IF NOT EXISTS hold(ticker TEXT, d INTEGER, reason TEXT, detail TEXT, PRIMARY KEY(ticker, d, reason));
"""


class PriceAuthorityError(RuntimeError):
    pass


class PriceHold(PriceAuthorityError):
    """The next required session cannot be appended safely: the refresh holds (previous authority stays)."""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def file_sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def content_sha(db_path: str, *, upto: int | None = None) -> tuple[str, int, int, int | None, int | None]:
    """Logical identity of a prices.py-schema DB: sha256 over every (ticker, d, c, v) in key order (float repr), and
    (rows, symbols, first, last). Independent of SQLite page layout. `upto`: only rows with d <= upto."""
    c = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        h = hashlib.sha256()
        n = 0
        syms = set()
        lo = hi = None
        q = "SELECT ticker, d, c, v FROM bar" + (" WHERE d<=?" if upto else "") + " ORDER BY ticker, d"
        for t, d, cc, v in c.execute(q, (upto,) if upto else ()):
            h.update(f"{t}\t{d}\t{cc!r}\t{v!r}\n".encode())
            n += 1
            syms.add(t)
            lo = d if lo is None or d < lo else lo
            hi = d if hi is None or d > hi else hi
        return h.hexdigest(), n, len(syms), lo, hi
    finally:
        c.close()


def _code() -> dict:
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain", "--", "api/services/marketcap"], cwd=repo,
                                    capture_output=True, text=True).stdout.strip())
        return {"commit": commit, "dirty": dirty}
    except Exception:  # noqa: BLE001
        return {"commit": None, "dirty": None}


def _readonly(path: str) -> None:
    os.chmod(path, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)


# ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────
class Store:
    def __init__(self, root: str):
        self.root = os.path.join(root, "prices")
        self.vdir = os.path.join(self.root, "versions")

    def path(self, vid: str, name: str) -> str:
        if not vid or "/" in vid or "\\" in vid or ".." in vid:
            raise PriceAuthorityError(f"bad price version id {vid!r}")
        return os.path.join(self.vdir, vid, name)

    def exists(self, vid: str) -> bool:
        return os.path.exists(self.path(vid, "manifest.json"))

    def manifest(self, vid: str) -> dict:
        p = self.path(vid, "manifest.json")
        if not os.path.exists(p):
            raise PriceAuthorityError(f"price version {vid} has no manifest")
        m = json.load(open(p))
        if m.get("format") != FORMAT or m.get("version_id") != vid or m.get("kind") not in KINDS:
            raise PriceAuthorityError(f"price manifest {vid} is malformed")
        for name, sha in (m.get("files") or {}).items():
            fp = self.path(vid, name)
            if not os.path.exists(fp) or file_sha(fp) != sha:
                raise PriceAuthorityError(f"price version {vid}: {name} is missing or does not match its sealed sha256")
        return m

    def approved(self, vid: str) -> dict | None:
        p = self.path(vid, "APPROVAL.json")
        return json.load(open(p)) if os.path.exists(p) else None

    def _write_once(self, vid: str, name: str, body: bytes | None = None, src: str | None = None) -> str:
        p = self.path(vid, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if os.path.exists(p):
            raise PriceAuthorityError(f"write-once: {vid}/{name} exists")
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".tmp-")
        os.close(fd)
        try:
            if src is not None:
                shutil.copyfile(src, tmp)
            else:
                open(tmp, "wb").write(body)
            os.link(tmp, p)
        finally:
            os.unlink(tmp)
        _readonly(p)
        return p

    def _seal(self, vid: str, manifest: dict) -> dict:
        """manifest.json is written LAST: a crash before it leaves no version (an incomplete dir is ignored and
        cleared on retry); after it, the version is complete and immutable."""
        self._write_once(vid, "manifest.json", json.dumps(manifest, indent=1, sort_keys=True, default=str).encode())
        return manifest

    def _clear_incomplete(self, vid: str) -> None:
        d = os.path.join(self.vdir, vid)
        if os.path.isdir(d) and not os.path.exists(os.path.join(d, "manifest.json")):
            for f in os.listdir(d):
                fp = os.path.join(d, f)
                os.chmod(fp, stat.S_IWRITE | stat.S_IREAD)
                os.remove(fp)
            os.rmdir(d)

    # ── lineage ──────────────────────────────────────────────────────────────────────────────────────────────────
    def chain(self, vid: str) -> list[dict]:
        """[base version manifest, APPEND, APPEND, ...] ending at vid. The base is a ROOT or an APPROVED correction."""
        out = []
        cur = vid
        while True:
            m = self.manifest(cur)
            out.append(m)
            if m["kind"] == "ROOT":
                break
            if m["kind"] == "HISTORICAL_CORRECTION":
                if not self.approved(cur):
                    raise PriceAuthorityError(f"{cur} is an UNAPPROVED historical correction: never a build input")
                break
            cur = m["parent"]
            if not cur:
                raise PriceAuthorityError(f"{m['version_id']} has no parent")
        return out[::-1]


# ── ROOT ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def seal_root(store: Store, src: str, *, expect_sha256: str, provenance: dict) -> dict:
    """Seal the accepted M3 price evidence as the lineage root, byte-for-byte (never re-exported, normalized or repaired)."""
    sha = file_sha(src)
    if sha != expect_sha256:
        raise PriceAuthorityError(f"root source sha {sha} != accepted {expect_sha256}: refusing to seal an approximation")
    vid = f"PRICE-ROOT-{sha[:16]}"
    if store.exists(vid):
        m = store.manifest(vid)
        if m["files"]["base.db"] != sha:
            raise PriceAuthorityError(f"{vid} exists with different bytes")
        return m
    store._clear_incomplete(vid)
    store._write_once(vid, "base.db", src=src)
    cs, n, syms, lo, hi = content_sha(store.path(vid, "base.db"))
    m = {"format": FORMAT, "version_id": vid, "kind": "ROOT", "parent": None, "created_at": now_iso(),
         "files": {"base.db": sha}, "bytes": os.path.getsize(store.path(vid, "base.db")),
         "content_sha256": cs, "materialized_sha256": cs, "rows": n, "symbols": syms, "first_session": lo,
         "last_session": hi, "appended": None, "provenance": provenance, "code": _code(),
         "validation": {"status": "ROOT", "note": "accepted M3 price evidence, sealed as-is"}}
    return store._seal(vid, m)


# ── upstream reading ────────────────────────────────────────────────────────────────────────────────────────────────
def _src_rows(src: str, d_from: int, d_to: int):
    """(ticker, d, c, v) from an upstream daily source: bars.db (`ohlcv`, tf='D') or a prices.py export (`bar`)."""
    c = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    tabs = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "ohlcv" in tabs:
        q = "SELECT ticker, ts, c, v FROM ohlcv WHERE tf='D' AND ts BETWEEN ? AND ? ORDER BY ticker, ts"
    elif "bar" in tabs:
        q = "SELECT ticker, d, c, v FROM bar WHERE d BETWEEN ? AND ? ORDER BY ticker, d"
    else:
        c.close()
        raise PriceAuthorityError(f"{src}: not a daily price source")
    try:
        yield from ((t, int(d), cc, v) for t, d, cc, v in c.execute(q, (d_from, d_to)))
    finally:
        c.close()


def _src_points(src: str, keys: set) -> dict:
    """{(ticker, d): close} for exactly `keys` from the upstream source."""
    c = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    tabs = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    q = ("SELECT c FROM ohlcv WHERE ticker=? AND tf='D' AND ts=?" if "ohlcv" in tabs else "SELECT c FROM bar WHERE ticker=? AND d=?")
    out = {}
    try:
        for t, d in keys:
            r = c.execute(q, (t, d)).fetchone()
            if r is not None:
                out[(t, d)] = r[0]
    finally:
        c.close()
    return out


def _ymd(d: int) -> date:
    return date(d // 10000, d // 100 % 100, d % 100)


def _int(x: date) -> int:
    return x.year * 10000 + x.month * 100 + x.day


def completed_sessions(after: int, now: datetime | None = None) -> list[int]:
    """NYSE sessions after `after` whose refresh is due by now (currentness.expected_session): no lookahead."""
    from . import currentness as CU
    exp = CU.expected_session(now or datetime.now(timezone.utc))
    out = []
    d = _ymd(after)
    from datetime import timedelta
    while d < exp:
        d += timedelta(days=1)
        if CU._cal().is_trading_day(d):
            out.append(_int(d))
    return out


# ── APPEND ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def _materialized_reader(store: Store, vid: str) -> str:
    """A materialized copy for reading (anchors / divergence); cached per version under <root>/prices/cache."""
    cdir = os.path.join(store.root, "cache")
    os.makedirs(cdir, exist_ok=True)
    out = os.path.join(cdir, f"{vid}.db")
    if not os.path.exists(out):
        materialize(store, vid, out + ".tmp")
        os.replace(out + ".tmp", out)
    return out


def _split_factor(splits: list, after: int, upto: int) -> list[tuple[str, float]]:
    """[(execution_date, price factor)] for reference splits executed in (after, upto]: a 1-for-20 reverse split
    (split_from=20, split_to=1) multiplies earlier prices by 20 on the new basis."""
    out = []
    for ex, frm, to in splits or []:
        if not ex or not frm or not to:
            continue
        e = int(ex.replace("-", ""))
        if after < e <= upto:
            out.append((ex, float(frm) / float(to)))
    return out


def _prod(it) -> float:
    out = 1.0
    for f in it:
        out *= f
    return out


def _close_eq(a: float, b: float) -> bool:
    return abs(a - b) <= max(1e-6 * abs(b), 5e-5)          # the aggregate's 4-decimal rounding


def _finality(c: float, v, oc, prev_close, conv: float = 1.0, prev_target=None):
    """(evidence, value on the TARGET basis) for a new bars.db row, or (None, None) -- NOT_FINAL, never appended.
    `oc` is the official aggregate close on its FETCH basis; `conv` the factor of reference splits executed after the
    target basis (this version's last session) and up to the fetch, so the official target-basis close is oc / conv.
      OFFICIAL             bars.db == the official close on the target basis (to the aggregate's rounding)
      OFFICIAL_SPLIT_BASIS bars.db already carries a later split (== oc on the fetch basis): value = c / conv
      NO_TRADE_CARRY       no trade (absent from the aggregate, volume 0, bars.db carried its previous close): the
                           previous target-basis value carries -- the root's own no-trade representation"""
    if oc is not None and oc > 0:
        if _close_eq(c, oc / conv):
            return "OFFICIAL", c
        if conv != 1.0 and _close_eq(c, oc):
            return "OFFICIAL_SPLIT_BASIS", c / conv
        return None, None
    if (v or 0) == 0 and prev_close is not None and c == prev_close and prev_target is not None:
        return "NO_TRADE_CARRY", prev_target
    return None, None


def append(store: Store, parent: str, source: str, *, official: dict, splits: dict, now: datetime | None = None,
           sessions: list[int] | None = None, provenance: dict | None = None, tickers: set | None = None,
           official_basis_date: int | None = None, official_fetched_at: str | None = None) -> dict:
    """Seal the APPEND child of `parent` holding every validated new completed session from `source`.
    official: {session(int): {ticker: close}} -- the official daily aggregate for each session (finality evidence).
    splits:   {ticker: [[execution_date, split_from, split_to], ...]} -- the reference snapshot of this refresh.
    Returns the child manifest, or {"no_new_session": True, "version_id": parent} when nothing is due.
    Raises PriceHold when the next due session cannot be validated (nothing sealed)."""
    pm = store.manifest(parent)
    store.chain(parent)                                            # an unapproved correction can never be a parent
    last = pm["last_session"]
    due = sessions if sessions is not None else completed_sessions(last, now)
    due = [d for d in due if d > last]
    if not due:
        return {"no_new_session": True, "version_id": parent, "last_session": last}
    pdb = _materialized_reader(store, parent)
    P = sqlite3.connect(f"file:{pdb}?mode=ro", uri=True)
    prev_pop = P.execute("SELECT COUNT(*) FROM bar WHERE d=?", (last,)).fetchone()[0]
    new_rows: dict[int, list] = {d: [] for d in due}
    seen = set()
    dup = 0
    for t, d, c, v in _src_rows(source, due[0], due[-1]):
        if d not in new_rows or (tickers is not None and t not in tickers):
            continue
        if (t, d) in seen:
            dup += 1
            continue
        seen.add((t, d))
        new_rows[d].append((t, d, c, v))
    # ── session-level validation: the append stops at the first session that is not provably complete ──────────
    accepted_sessions, session_report = [], []
    for d in due:
        rows = new_rows[d]
        off = official.get(d) or official.get(str(d))
        rep = {"session": d, "source_rows": len(rows)}
        if dup:
            rep["duplicates_dropped"] = dup
        if not off:
            rep["hold"] = "NO_OFFICIAL_DAILY_AGGREGATE"
        elif not rows:
            rep["hold"] = "SESSION_ABSENT_UPSTREAM"
        elif prev_pop and len(rows) < POPULATION_FLOOR * prev_pop:
            rep["hold"] = f"POPULATION_COLLAPSE {len(rows)} < {POPULATION_FLOOR:.0%} of {prev_pop}"
        else:
            bad = sum(1 for _t, _d, c, _v in rows if c is None or not (c > 0))
            if bad > INVALID_ROW_CEILING * len(rows):
                rep["hold"] = f"INVALID_CLOSES {bad}/{len(rows)}"
        session_report.append(rep)
        if "hold" in rep:
            break
        accepted_sessions.append(d)
    if not accepted_sessions:
        P.close()
        raise PriceHold(f"price append held at {session_report[-1]['session']}: {session_report[-1]['hold']}")
    upto = accepted_sessions[-1]
    today = _int((now or datetime.now(timezone.utc)).date())
    # the official aggregate is split-adjusted for a split only if it was FETCHED after that split's effective open
    # (09:30 ET on the execution date): ITOC 1-for-16 on 2026-10-06, aggregate fetched 2026-10-06 03:53Z = 23:53 ET
    # 10-05 -> NOT yet adjusted. `fetched` = the last execution date the fetch can reflect.
    if official_fetched_at:
        from zoneinfo import ZoneInfo
        fet = datetime.fromisoformat(official_fetched_at.replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York"))
        fd = fet.date() if (fet.hour, fet.minute) >= (9, 30) else fet.date() - __import__("datetime").timedelta(days=1)
        fetched = _int(fd)
    else:
        fetched = int(official_basis_date or today)
    tick = sorted({r[0] for d in accepted_sessions for r in new_rows[d]})
    # ── (1) BASIS EVENTS -- the price basis must be the basis the builder normalizes shares to: every REFERENCE split
    # executed in (parent's last session, this version's last session] of any ticker the lineage carries. The factor
    # is the reference's own (the same evidence the share ledger applies), so Market Cap is invariant by construction;
    # stored observations never change (materialization applies it). Upstream corroboration is recorded, not required:
    # bars.db may not have re-based yet (KUST 2026-10-01: history still pre-split, new rows post-split).
    carried = {t for (t,) in P.execute("SELECT DISTINCT ticker FROM bar")} | set(tick)
    events: list[tuple] = []
    for t in sorted(carried):
        for ex, f in _split_factor(splits.get(t) or [], last, upto):
            events.append((t, ex, f))
    ev_of: dict[str, list] = {}
    for t, ex, f in events:
        ev_of.setdefault(t, []).append((int(ex.replace("-", "")), f))
    # anchors: EACH ticker's own last <= ANCHOR_DAYS stored rows (materialized parent basis) and the upstream rows of
    # those keys -- divergence evidence, and the detector of an upstream re-basing no reference split explains
    anc_t = sorted(set(tick) | set(ev_of))
    anchors = {t: P.execute("SELECT d, c FROM bar WHERE ticker=? ORDER BY d DESC LIMIT ?", (t, ANCHOR_DAYS)).fetchall()
               for t in anc_t}
    P.close()
    up_anchor = _src_points(source, {(t, d) for t, a in anchors.items() for d, _c in a})
    holds, keep, ev_rows = [], [], []
    basis_of: dict[str, str] = {}
    for t, ex, f in events:
        a = anchors.get(t) or []
        rs = [up_anchor.get((t, d)) / c for d, c in a if c and up_anchor.get((t, d))]
        corr = ("UPSTREAM_REBASED" if rs and all(abs(r / f - 1) < 1e-4 for r in rs) else
                "UPSTREAM_NOT_YET_REBASED" if rs and all(abs(r - 1) < 1e-6 for r in rs) else
                "NO_UPSTREAM_ANCHOR" if not rs else "UPSTREAM_OTHER")
        ev_rows.append((t, ex, f, rs[0] if rs else None, corr))
    for t in tick:
        a = anchors.get(t)
        if not a:
            basis_of[t] = "NEW_LISTING"
            continue
        rs = [(up_anchor.get((t, d)) / c) if c and up_anchor.get((t, d)) else None for d, c in a]
        known = [f for _e, f in ev_of.get(t, [])] + [f for _ex, f in _split_factor(splits.get(t) or [], upto, fetched)]
        prod = 1.0
        for f in known:
            prod *= f
        if len(rs) >= 3 and all(r is not None for r in rs) and all(abs(r / rs[0] - 1) < 1e-6 for r in rs)                 and abs(rs[0] - 1) > 1e-6 and not any(abs(rs[0] / k - 1) < 1e-4 for k in (prod, 1 / prod)):
            holds.append((t, accepted_sessions[0], "PRICE_BASIS_DIVERGENCE",
                          f"upstream history re-based by {rs[0]:.6g} with no reference split explaining it"))
            basis_of[t] = "HOLD"
        else:
            basis_of[t] = "SAME_BASIS" if all(r is not None and abs(r - 1) < 1e-6 for r in rs) else "UPSTREAM_DIVERGED"
    held = {h[0] for h in holds}
    # ── (2) every new row: final on the TARGET basis (reference splits <= this version's last session) ─────────────
    finality_mismatch = 0
    finality: dict[str, int] = {}
    last_up = {t: up_anchor.get((t, a[0][0])) for t, a in anchors.items() if a}
    last_t = {}
    for t, a in anchors.items():
        if a:                                          # the parent's last value, carried onto the target basis
            last_t[t] = a[0][1] * _prod(f for e, f in ev_of.get(t, []) if a[0][0] < e)
    for d in accepted_sessions:
        off = official.get(d) or official.get(str(d)) or {}
        for t, _d, c, v in new_rows[d]:
            if t in held:
                continue
            if c is None or not (c > 0):
                holds.append((t, d, "INVALID_CLOSE", repr(c)))
                continue
            conv = _prod(f for _ex, f in _split_factor(splits.get(t) or [], max(d, upto), fetched))
            how, val = _finality(c, v, off.get(t), last_up.get(t), conv, last_t.get(t))
            last_up[t] = c
            if how is None:
                finality_mismatch += 1
                holds.append((t, d, "NOT_FINAL", f"bars.db close {c!r} vol {v!r} vs official {off.get(t)!r}"))
                continue
            finality[how] = finality.get(how, 0) + 1
            last_t[t] = val
            # stored on the ROOT basis: divided back by this version's events effective after the row
            keep.append((t, d, val / _prod(f for e, f in ev_of.get(t, []) if d < e), v))
    events = [(t, ex, f, r, corr) for t, ex, f, r, corr in ev_rows]
    # a ticker held on one session is not appended on any later session of this version (no hole-then-resume)
    first_hold = {}
    for t, d, *_ in holds:
        first_hold[t] = min(first_hold.get(t, 99999999), d)
    keep = [r for r in keep if r[1] < first_hold.get(r[0], 99999999)]
    # ── seal ────────────────────────────────────────────────────────────────────────────────────────────────────
    keep.sort()
    h = hashlib.sha256(parent.encode())
    for r in keep:
        h.update(f"{r[0]}\t{r[1]}\t{r[2]!r}\t{r[3]!r}\n".encode())
    for e in sorted(events):
        h.update(("E" + json.dumps(e)).encode())
    for x in sorted(holds):
        h.update(("H" + json.dumps(x)).encode())
    vid = f"PRICE-APPEND-{upto}-{h.hexdigest()[:12]}"
    if store.exists(vid):                                          # an orphan of an earlier attempt: exact reuse
        m = store.manifest(vid)
        m["reused"] = True
        return m
    store._clear_incomplete(vid)
    tmpdir = tempfile.mkdtemp(dir=store.root)
    try:
        dpath = os.path.join(tmpdir, "delta.db")
        D = sqlite3.connect(dpath)
        D.executescript(DELTA_DDL)
        D.executemany("INSERT INTO bar VALUES(?,?,?,?)", keep)
        D.executemany("INSERT INTO basis_event VALUES(?,?,?,?,?)", events)
        D.executemany("INSERT OR IGNORE INTO hold VALUES(?,?,?,?)", holds)
        D.commit()
        D.close()
        if any(d <= last for _t, d, _c, _v in keep):
            raise PriceAuthorityError("APPEND would insert a historical key: refused")
        store._write_once(vid, "delta.db", src=dpath)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    m = {"format": FORMAT, "version_id": vid, "kind": "APPEND", "parent": parent, "created_at": now_iso(),
         "files": {"delta.db": file_sha(store.path(vid, "delta.db"))},
         "bytes": os.path.getsize(store.path(vid, "delta.db")),
         "appended": {"sessions": accepted_sessions, "rows": len(keep), "symbols": len({r[0] for r in keep}),
                      "new_listings": sorted(t for t, b in basis_of.items() if b == "NEW_LISTING"),
                      "basis_events": [list(e[:3]) for e in events], "holds": len(holds),
                      "holds_by_reason": _count(h_[2] for h_ in holds), "finality_mismatch": finality_mismatch,
                      "finality_evidence": finality},
         "session_report": session_report, "provenance": provenance or {}, "code": _code()}
    m.update(rows=pm["rows"] + len(keep), first_session=pm["first_session"], last_session=upto)
    # materialize once to record the build input's identity, and PROVE the invariant on it
    tmp_out = os.path.join(store.root, f".verify-{vid}.db")
    try:
        _materialize_chain(store, store.chain(parent) + [{**m, "_unsealed": True}], tmp_out, vid_hint=vid)
        cs, n, syms, _lo, hi = content_sha(tmp_out)
        if n != m["rows"] or hi != upto:
            raise PriceAuthorityError(f"materialized child has {n} rows / last {hi}; expected {m['rows']} / {upto}")
        if not events:
            pcs = content_sha(tmp_out, upto=last)[0]
            if pcs != pm["materialized_sha256"]:
                raise PriceAuthorityError("APPEND changed the parent's history (content hash differs): refused")
        m.update(materialized_sha256=cs, symbols=syms, content_sha256=cs,
                 validation={"status": "PASS", "parent_history_identical": not events,
                             "parent_history_identical_on_stored_basis": True})
    finally:
        if os.path.exists(tmp_out):
            os.remove(tmp_out)
    return store._seal(vid, m)


def _count(it) -> dict:
    out: dict = {}
    for x in it:
        out[x] = out.get(x, 0) + 1
    return out


# ── MATERIALIZE ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _materialize_chain(store: Store, chain: list[dict], out: str, vid_hint: str | None = None) -> None:
    base = chain[0]
    if os.path.exists(out):
        os.chmod(out, stat.S_IWRITE | stat.S_IREAD)
        os.remove(out)
    shutil.copyfile(store.path(base["version_id"], "base.db"), out)
    os.chmod(out, stat.S_IWRITE | stat.S_IREAD)
    if len(chain) == 1:
        return
    db = sqlite3.connect(f"file:{out}", uri=True)
    try:
        events = []
        for m in chain[1:]:
            vid = m["version_id"]
            dpath = store.path(vid, "delta.db")
            db.execute("ATTACH DATABASE ? AS dl", (f"file:{dpath}?mode=ro",))
            try:
                db.execute("INSERT INTO main.bar SELECT ticker, d, c, v FROM dl.bar ORDER BY ticker, d")
            except sqlite3.IntegrityError:
                raise PriceAuthorityError(f"{vid}: a delta row collides with an existing key (history mutation)")
            events += db.execute("SELECT ticker, effective, factor FROM dl.basis_event").fetchall()
            db.commit()
            db.execute("DETACH DATABASE dl")
        for t, eff, f in events:                                  # the materialized basis = today's split basis
            db.execute("UPDATE bar SET c = c * ? WHERE ticker=? AND d < ?", (f, t, int(eff.replace("-", ""))))
        db.commit()
    finally:
        db.close()


def materialize(store: Store, vid: str, out: str, *, allow_candidate: bool = False) -> dict:
    """The exact build input of price version `vid` at `out`, verified against the sealed content hash.
    `allow_candidate`: ONLY the correction-impact driver may read an unapproved correction (dark); a refresh never can."""
    if allow_candidate and store.manifest(vid)["kind"] == "HISTORICAL_CORRECTION":
        chain = [store.manifest(vid)]
    else:
        chain = store.chain(vid)
    _materialize_chain(store, chain, out)
    m = chain[-1]
    cs, n, syms, lo, hi = content_sha(out)
    if cs != m["materialized_sha256"] or n != m["rows"]:
        raise PriceAuthorityError(f"materialized {vid} does not match its sealed content hash")
    return {"price_version": vid, "kind": m["kind"], "parent": m.get("parent"), "content_sha256": cs, "rows": n,
            "symbols": syms, "first_session": lo, "last_session": hi, "file_sha256": file_sha(out),
            "chain": [c["version_id"] for c in chain]}


# ── HISTORICAL CORRECTION (explicit, human-approved) ────────────────────────────────────────────────────────────────
def diff(old_db: str, new_db: str, *, upto: int | None = None) -> dict:
    """Exact historical diff of two prices.py-schema DBs over d <= upto (default: the old one's last session)."""
    c = sqlite3.connect(f"file:{old_db}?mode=ro", uri=True)
    c.execute("ATTACH DATABASE ? AS n", (f"file:{new_db}?mode=ro",))
    upto = upto or c.execute("SELECT MAX(d) FROM bar").fetchone()[0]
    lost = c.execute("SELECT o.ticker, COUNT(*), MIN(o.d), MAX(o.d) FROM main.bar o WHERE o.d<=? AND NOT EXISTS "
                     "(SELECT 1 FROM n.bar x WHERE x.ticker=o.ticker AND x.d=o.d) GROUP BY o.ticker", (upto,)).fetchall()
    gained = c.execute("SELECT x.ticker, COUNT(*), MIN(x.d), MAX(x.d) FROM n.bar x WHERE x.d<=? AND NOT EXISTS "
                       "(SELECT 1 FROM main.bar o WHERE o.ticker=x.ticker AND o.d=x.d) GROUP BY x.ticker", (upto,)).fetchall()
    changed = c.execute("SELECT o.ticker, COUNT(*), MIN(o.d), MAX(o.d), MIN(x.c/o.c), MAX(x.c/o.c) FROM main.bar o "
                        "JOIN n.bar x ON x.ticker=o.ticker AND x.d=o.d WHERE o.d<=? AND o.c>0 AND x.c>0 "
                        "AND ABS(x.c/o.c-1) > 1e-9 GROUP BY o.ticker", (upto,)).fetchall()
    c.close()
    rebased = [r for r in changed if r[1] > 20 and abs(r[4] / r[5] - 1) < 1e-6]
    repaired = [r for r in changed if r[1] <= 3]
    recent = [r for r in lost if r[3] >= upto - 10000]
    return {"upto": upto,
            "lost": {"tickers": len(lost), "rows": sum(r[1] for r in lost), "recent_window_tickers": [r[0] for r in recent]},
            "gained": {"tickers": len(gained), "rows": sum(r[1] for r in gained)},
            "changed": {"tickers": len(changed), "rows": sum(r[1] for r in changed),
                        "rebased_constant_factor": len(rebased), "repaired_1_to_3_days": len(repaired),
                        "large_factor": sorted([[r[0], r[4], r[5]] for r in changed if max(r[5], 1 / max(r[4], 1e-12)) >= 2],
                                               key=lambda x: -max(x[2], 1 / max(x[1], 1e-12)))[:25]},
            "affected_tickers": sorted({r[0] for r in lost} | {r[0] for r in gained} | {r[0] for r in changed}),
            "examples": {"lost": sorted(lost, key=lambda r: -r[1])[:10], "changed": sorted(changed, key=lambda r: -r[1])[:10]}}


def propose_correction(store: Store, parent: str, corrected_db: str, *, reason: str, provenance: dict) -> dict:
    """Seal a HISTORICAL_CORRECTION CANDIDATE (a complete corrected snapshot) with its exact diff vs `parent`.
    Never authoritative until `approve`; the Market Cap impact is measured by a dark refresh pinned to it
    (refresh policy.price_version) running the full release gates."""
    pm = store.manifest(parent)
    sha = file_sha(corrected_db)
    vid = f"PRICE-CORRECTION-{sha[:16]}"
    if store.exists(vid):
        return store.manifest(vid)
    store._clear_incomplete(vid)
    report = diff(_materialized_reader(store, parent), corrected_db)
    store._write_once(vid, "base.db", src=corrected_db)
    store._write_once(vid, "diff.json", json.dumps(report, indent=1, default=str).encode())
    cs, n, syms, lo, hi = content_sha(store.path(vid, "base.db"))
    m = {"format": FORMAT, "version_id": vid, "kind": "HISTORICAL_CORRECTION", "parent": parent, "created_at": now_iso(),
         "files": {"base.db": sha, "diff.json": file_sha(store.path(vid, "diff.json"))},
         "bytes": os.path.getsize(store.path(vid, "base.db")), "content_sha256": cs, "materialized_sha256": cs,
         "rows": n, "symbols": syms, "first_session": lo, "last_session": hi, "reason": reason,
         "status": "CANDIDATE", "diff_summary": {k: report[k] for k in ("lost", "gained", "changed")},
         "provenance": provenance, "code": _code(), "parent_last_session": pm["last_session"]}
    return store._seal(vid, m)


def approve(store: Store, vid: str, *, by: str, reason: str, market_cap_gates: str) -> dict:
    """The ONLY way a correction becomes usable: a human, after the dark Market Cap refresh pinned to it PASSED."""
    m = store.manifest(vid)
    if m["kind"] != "HISTORICAL_CORRECTION":
        raise PriceAuthorityError("only a HISTORICAL_CORRECTION is approved")
    if market_cap_gates != "PASS":
        raise PriceAuthorityError("a correction whose Market Cap release gates did not PASS cannot be approved")
    if not by or by.startswith("refresh:") or by.startswith("scheduler"):
        raise PriceAuthorityError("historical corrections are approved by a human, never by a refresh or the scheduler")
    rec = {"version_id": vid, "approved_by": by, "reason": reason, "approved_at": now_iso(), "market_cap_gates": "PASS"}
    store._write_once(vid, "APPROVAL.json", json.dumps(rec, indent=1).encode())
    return rec


# ── divergence monitor (operational; never changes anything) ────────────────────────────────────────────────────────
def divergence(store: Store, vid: str, source: str, *, since: int | None = None) -> dict:
    """Accepted price authority vs the current upstream daily source over already-accepted history (all of it, or
    sessions >= `since`). OPERATIONAL ONLY: it reports that upstream history moved; it never changes the lineage."""
    tmp = os.path.join(store.root, "cache", f"upstream-{os.getpid()}.db")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    m = store.manifest(vid)
    lo = since or 0
    db = sqlite3.connect(tmp)
    db.executescript(DDL)
    db.executemany("INSERT OR IGNORE INTO bar VALUES(?,?,?,?)", _src_rows(source, lo, m["last_session"]))
    db.commit()
    db.close()
    try:
        auth = _materialized_reader(store, vid)
        if since:                                         # compare like with like: the authority's window only
            win = os.path.join(store.root, "cache", f"window-{os.getpid()}.db")
            w = sqlite3.connect(f"file:{win}", uri=True)
            try:
                w.executescript(DDL)
                w.execute("ATTACH DATABASE ? AS a", (f"file:{auth}?mode=ro",))
                w.execute("INSERT INTO main.bar SELECT ticker, d, c, v FROM a.bar WHERE d >= ?", (lo,))
                w.commit()
            finally:
                w.close()
            auth = win
        out = diff(auth, tmp)
        out.update(price_version=vid, measured_at=now_iso(), window_from=lo or None)
        return out
    finally:
        for f in (tmp, os.path.join(store.root, "cache", f"window-{os.getpid()}.db")):
            if os.path.exists(f):
                os.remove(f)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Market Cap price authority (operator CLI)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seal-root"); s.add_argument("--root", required=True); s.add_argument("--src", required=True)
    s.add_argument("--sha256", required=True); s.add_argument("--provenance", default="{}")
    s = sub.add_parser("show"); s.add_argument("--root", required=True); s.add_argument("--version", required=True)
    s = sub.add_parser("materialize"); s.add_argument("--root", required=True); s.add_argument("--version", required=True)
    s.add_argument("--out", required=True)
    s = sub.add_parser("propose-correction"); s.add_argument("--root", required=True); s.add_argument("--parent", required=True)
    s.add_argument("--corrected", required=True); s.add_argument("--reason", required=True)
    s = sub.add_parser("approve"); s.add_argument("--root", required=True); s.add_argument("--version", required=True)
    s.add_argument("--by", required=True); s.add_argument("--reason", required=True)
    s.add_argument("--market-cap-gates", required=True)
    s = sub.add_parser("divergence"); s.add_argument("--root", required=True); s.add_argument("--version", required=True)
    s.add_argument("--source", required=True)
    a = ap.parse_args(argv)
    st = Store(a.root)
    if a.cmd == "seal-root":
        r = seal_root(st, a.src, expect_sha256=a.sha256, provenance=json.loads(a.provenance))
    elif a.cmd == "show":
        r = st.manifest(a.version)
    elif a.cmd == "materialize":
        r = materialize(st, a.version, a.out)
    elif a.cmd == "propose-correction":
        r = propose_correction(st, a.parent, a.corrected, reason=a.reason, provenance={"cli": True})
    elif a.cmd == "approve":
        r = approve(st, a.version, by=a.by, reason=a.reason, market_cap_gates=a.market_cap_gates)
    else:
        r = divergence(st, a.version, a.source)
    print(json.dumps(r, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
