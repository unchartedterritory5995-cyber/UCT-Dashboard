"""NYSE + NASDAQ Breadth (Exchange Breadth V1) — THE member-authority seam.

ONE AUTHORITY, ONE POINTER. Members' `nyse` / `nasdaq` breadth (base series + AD / MCO / MCS) is the
continuous series formed by exactly three immutable artifacts:

    historical  breadth_exch_v1_FINAL_…_FROZEN    2008-01-02 (NASDAQ) / 2009-06-11 (NYSE) … 2026-09-24
    derived     breadth_exch_v1_DERIVED_…_FROZEN  AD / MCO / MCS over the same span
    live        a snapshot of the append-only exchange live store, 2026-09-25 … latest

named by ONE pointer document (`AUTHORITY.json`, in the object store under `PREFIX`). The pointer is the
whole switch: publishing a new snapshot, cutting over and rolling back are each one atomic PUT of a new
pointer, and a reader adopts a pointer only after every artifact it names is downloaded, hash-verified and
the SET is proven continuous (`verify_set`). Until then the previously installed authority keeps serving.

⛔ FAIL CLOSED, NEVER FALL BACK. With `BREADTH_AUTHORITY_EXCH=v1` and no verified authority installed,
`nyse` / `nasdaq` answer EMPTY — never the V1 store and never the US V2 producer's `nyse`/`nasdaq` rows
(today-venue membership, which fails point-in-time). With the flag unset/`off` this module answers None
everywhere and every reader is byte-identical to before; `breadth_universes.published_universe_ids` also
refuses to publish `nyse`/`nasdaq` unless this seam serves them.

⛔ A POINTER CANNOT MOVE THE FROZEN BASE. The historical and derived identities are pinned HERE; a pointer
naming anything else, or a live store whose lineage names anything else (or is a PROOF store), is refused.
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import importlib.util
import json
import os
import sqlite3
import threading
import time
from typing import Optional

# ── the pinned identity of the authority (changing any of these is a reviewed code change) ───────
HIST_NAME = "breadth_exch_v1_FINAL_v20260924f_VALIDATED_FROZEN_2026-10-05.db"
HIST_SHA256 = "e65b2af0779d5ff8cdce8668f866f0889e070207a260e88a64cd9d38c37462a0"
DER_NAME = "breadth_exch_v1_DERIVED_ad-mco-mcs_FROM_e65b2af0_VALIDATED_FROZEN_2026-10-05.db"
DER_SHA256 = "f9ed6966dfd7d6d5459761f06f8224cfc1f1807e42a9f088279bc8b164634d86"
LEDGER_SHA256 = "4ccf140fecd30ed4a4a54d9ca2ad3f6dfb92cb53f02bb8e4054df1bf19b40d63"
IDENTITY_PARENT_SHA256 = "0acbe59fe1e86549a5e92e8445a2d5b1e63f189e68cbfaf0d301b775106cd8f3"
EXCEPTIONS_SHA256 = "3ddf3ac75675eccdae78b3c95ddaaa0a3a835f97aed2c3734c7eede8e5141f91"
PINS_SHA256 = "cc3107f9c9526eb6612aa287521f8053f35bc5fa63b7b92820b6b5b578282dd3"
FROZEN_END = "2026-09-24"
LIVE_START = "2026-09-25"
START = {"nyse": "2009-06-11", "nasdaq": "2008-01-02"}
#: first published MCO/MCS session (the 121st valid observation) — pinned from the frozen derived artifact
MCO_FIRST = {"nyse": "2009-12-01", "nasdaq": "2008-06-24"}
UNIVERSES = ("nyse", "nasdaq")
EXCHANGE_OF = {"nyse": "NYSE", "nasdaq": "NASDAQ"}
DERIVED_KINDS = ("AD", "MCO", "MCS")
METHODOLOGY = {"base": "rth-1m-composites-v2c2-div+ema-tie-exact-v1 (exchange: +unchanged)",
               "membership": "venue-ledger-v1 + identity-v1 Bridge; live venue evidence after the ledger",
               "ad": "adline-v1 (base 0, holes hold)",
               "mco": "mcclellan-v1/ratio_adjusted (seed 0, 120-session burn-in, unchanged excluded)",
               "mcs": "cumulative MCO from the declared epoch, base 0"}

KIND = "exchange-breadth-v1-authority"
SCHEMA = 1
PREFIX = os.environ.get("BREADTH_EXCH_R2_PREFIX", "breadth_exch/v1/")
POINTER_KEY = "AUTHORITY.json"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))


class Refused(Exception):
    def __init__(self, reason: str, detail=None):
        super().__init__("%s %s" % (reason, json.dumps(detail, default=str)[:600] if detail is not None else ""))
        self.reason, self.detail = reason, detail


def mode() -> str:
    v = (os.environ.get("BREADTH_AUTHORITY_EXCH") or "off").strip().lower()
    return v if v in ("off", "v1") else "off"


def _root() -> str:
    return os.environ.get("BREADTH_EXCH_DIR") or (
        "/data/breadth_exch_replica" if os.path.isdir("/data") else
        os.path.join(REPO, "data", "breadth_exch_replica"))


def sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha_file(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _load_by_file(name: str, rel: str):
    p = os.path.join(REPO, rel)
    spec = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_MODS: dict = {}


def _lc():
    """tools/breadth_exch/live_core.py — the SAME derivation step and logical hash the live leg uses."""
    if "lc" not in _MODS:
        _MODS["lc"] = _load_by_file("exch_live_core_for_reader", "tools/breadth_exch/live_core.py")
    return _MODS["lc"]


def _cal():
    """The pinned exchange calendar (the bytes the live leg plans its sessions with)."""
    if "cal" not in _MODS:
        _MODS["cal"] = _load_by_file("exch_pinned_calendar", "tools/breadth_exch/pinned/breadth_calendar.py")
    return _MODS["cal"]


# ── object stores (R2 in production; a directory for drills and tests) ─────────────────────────────
class DirStore:
    """A directory standing in for R2 under the same keys — the isolated authority namespace."""

    def __init__(self, root: str):
        self.root = root

    def _p(self, key: str) -> str:
        return os.path.join(self.root, *key.split("/"))

    def get(self, key: str) -> bytes:
        with open(self._p(key), "rb") as f:
            return f.read()

    def exists(self, key: str) -> bool:
        return os.path.exists(self._p(key))

    def put(self, key: str, body: bytes) -> None:
        p = self._p(key)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + ".tmp.%d" % os.getpid()
        with open(tmp, "wb") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p)                                   # one atomic switch, like an object PUT

    def describe(self) -> str:
        return "dir:" + self.root


class R2Store:
    def __init__(self, client, bucket):
        self.cl, self.bk = client, bucket

    def get(self, key: str) -> bytes:
        return self.cl.get_object(Bucket=self.bk, Key=key)["Body"].read()

    def exists(self, key: str) -> bool:
        try:
            self.cl.head_object(Bucket=self.bk, Key=key)
            return True
        except Exception:  # noqa: BLE001
            return False

    def put(self, key: str, body: bytes) -> None:
        self.cl.put_object(Bucket=self.bk, Key=key, Body=body,
                           ContentType="application/json" if key.endswith(".json") else "application/gzip")

    def describe(self) -> str:
        return "r2:" + str(self.bk)


def object_store():
    """`BREADTH_EXCH_OBJECT_DIR` → an isolated DirStore (drills); else R2; None without credentials."""
    d = os.environ.get("BREADTH_EXCH_OBJECT_DIR")
    if d:
        return DirStore(d)
    from api.services import breadth_ohlc_sync as bos
    cl, bk = bos._client(), bos._bucket()
    return R2Store(cl, bk) if (cl and bk) else None


def key(rel: str) -> str:
    return PREFIX + rel


def object_key(sha: str) -> str:
    return key("objects/%s.db.gz" % sha)


# ── the pointer document ───────────────────────────────────────────────────────────────────────────
def encode_pointer(doc: dict) -> bytes:
    return (json.dumps(doc, sort_keys=True, indent=1) + "\n").encode()


def parse_pointer(b: bytes) -> dict:
    try:
        p = json.loads(b)
    except Exception as e:  # noqa: BLE001
        raise Refused("POINTER_MALFORMED", type(e).__name__)
    need = {"kind", "schema", "publication_version", "published_at", "historical", "derived", "live", "lineage",
            "previous", "rollback_of", "methodology"}
    if not isinstance(p, dict) or not need <= set(p) or p["kind"] != KIND or p["schema"] != SCHEMA:
        raise Refused("POINTER_MALFORMED", sorted(p) if isinstance(p, dict) else None)
    if not isinstance(p["publication_version"], int) or p["publication_version"] < 1:
        raise Refused("POINTER_MALFORMED", "publication_version")
    for a in ("historical", "derived", "live"):
        art = p[a]
        if not isinstance(art, dict) or not all(isinstance(art.get(k), str) for k in ("sha256", "gz_sha256", "key")) \
                or not isinstance(art.get("bytes"), int):
            raise Refused("POINTER_MALFORMED", a)
    if p["historical"]["sha256"] != HIST_SHA256 or p["derived"]["sha256"] != DER_SHA256:
        raise Refused("FROZEN_BASE_MISMATCH", {"historical": p["historical"]["sha256"],
                                               "derived": p["derived"]["sha256"]})
    return p


# ── set verification: THE definition of "this is the member authority" ─────────────────────────────
def _ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect("file:%s?mode=ro&immutable=1" % path, uri=True)


def verify_set(p: dict, hist: str, der: str, live: str) -> dict:
    """Prove a pointer's three local files ARE one continuous authority. Returns the view summary."""
    for name, path, art in (("historical", hist, p["historical"]), ("derived", der, p["derived"]),
                            ("live", live, p["live"])):
        if not os.path.isfile(path) or os.path.getsize(path) != art["bytes"] or sha_file(path) != art["sha256"]:
            raise Refused("ARTIFACT_HASH_MISMATCH", name)
    lc = _lc()
    lv = _ro(live)
    try:
        lin = dict(lv.execute("SELECT key, value FROM lineage"))
        want = {"historical_sha256": HIST_SHA256, "derived_sha256": DER_SHA256, "ledger_sha256": LEDGER_SHA256,
                "identity_parent_sha256": IDENTITY_PARENT_SHA256, "owner_vintage_exceptions_sha256": EXCEPTIONS_SHA256,
                "pins_sha256": PINS_SHA256, "frozen_end": FROZEN_END, "nyse_start": START["nyse"],
                "nasdaq_start": START["nasdaq"], "mode": "append", "substitution": "{}", "pinned_vintage": ""}
        bad = {k: lin.get(k) for k, v in want.items() if lin.get(k) != v}
        if bad:
            raise Refused("LIVE_LINEAGE_MISMATCH", bad)
        if lin.get("code_commit") != p["lineage"].get("code_commit"):
            raise Refused("LIVE_LINEAGE_MISMATCH", {"code_commit": lin.get("code_commit")})
        sess = lv.execute("SELECT date, seq, rows, rows_sha256 FROM live_session ORDER BY seq").fetchall()
        if not sess:
            raise Refused("LIVE_EMPTY")
        dates = [s[0] for s in sess]
        if [s[1] for s in sess] != list(range(1, len(sess) + 1)):
            raise Refused("LIVE_SEQUENCE", [s[1] for s in sess][:10])
        cal = _cal()
        plan, d = [], dt.date.fromisoformat(FROZEN_END) + dt.timedelta(days=1)
        while d.isoformat() <= dates[-1]:
            if cal.is_trading_day(d.isoformat()):
                plan.append(d.isoformat())
            d += dt.timedelta(days=1)
        if dates != plan:                                       # no duplicate, missing or extra session
            raise Refused("LIVE_SESSIONS_NOT_CONTIGUOUS", {"have": dates[:3] + ["…"] + dates[-3:],
                                                           "missing": sorted(set(plan) - set(dates))[:5],
                                                           "extra": sorted(set(dates) - set(plan))[:5]})
        if dates[0] != LIVE_START:
            raise Refused("LIVE_BOUNDARY", dates[0])
        if (p["live"].get("first_session"), p["live"].get("latest_session"), p["live"].get("session_count")) != \
                (dates[0], dates[-1], len(dates)):
            raise Refused("POINTER_LIVE_SUMMARY_MISMATCH", {"store": [dates[0], dates[-1], len(dates)]})
        for d_, _seq, n, rs in sess:
            rows = lv.execute("SELECT universe, date, metric, o, h, l, c, source FROM breadth_daily_ohlc WHERE date=?",
                              (d_,)).fetchall()
            if len(rows) != n or lc.rows_sha(rows) != rs:
                raise Refused("LIVE_ROWS_HASH", d_)
        orphans = sum(lv.execute(f"SELECT COUNT(*) FROM {t} WHERE date NOT IN (SELECT date FROM live_session)")
                      .fetchone()[0] for t in lc.CONTENT_TABLES)
        if orphans:
            raise Refused("LIVE_ORPHAN_ROWS", orphans)
        if lc.logical_sha256_conn(lv) != p["live"].get("logical_sha256"):
            raise Refused("LIVE_LOGICAL_HASH_MISMATCH")
        live_der = {(s_, d_): v for s_, d_, v in lv.execute("SELECT series, date, value FROM derived_series")}
        live_ad = {}
        for u, d_, m, c in lv.execute("SELECT universe, date, metric, c FROM breadth_daily_ohlc WHERE "
                                      "metric IN ('advancing','declining')"):
            live_ad.setdefault((u, d_), {})[m] = c
    finally:
        lv.close()
    # continuity: ONE forward pass over frozen + live inputs reproduces frozen AND live derived, bit-exact
    hc, dc = _ro(hist), _ro(der)
    try:
        frozen_der = {(s_, d_): v for s_, d_, v in dc.execute("SELECT series, date, value FROM derived_series")}
        for u in UNIVERSES:
            X = EXCHANGE_OF[u]
            ser = {}
            for d_, m, c in hc.execute("SELECT date, metric, c FROM breadth_daily_ohlc WHERE universe=? AND date>=? "
                                       "AND metric IN ('advancing','declining')", (u, START[u])):
                ser.setdefault(d_, {})[m] = c
            hist_last = max(ser)
            if hist_last != FROZEN_END:
                raise Refused("FROZEN_BOUNDARY", {u: hist_last})
            for d_ in dates:
                if (u, d_) not in live_ad:
                    raise Refused("LIVE_MISSING_UNIVERSE", {u: d_})
                ser[d_] = live_ad[(u, d_)]
            st = {"ad": None, "ema_fast": None, "ema_slow": None, "valid_obs": 0, "mcs": None}
            for d_ in sorted(ser):
                st, out = lc.derive_step(st, ser[d_].get("advancing"), ser[d_].get("declining"))
                ref = frozen_der if d_ <= FROZEN_END else live_der
                for k in DERIVED_KINDS:
                    if out[k] != ref.get(("%s:%s" % (X, k), d_)):
                        raise Refused("DERIVED_DISCONTINUITY", {"series": "%s:%s" % (X, k), "date": d_,
                                                                "computed": out[k],
                                                                "stored": ref.get(("%s:%s" % (X, k), d_))})
    finally:
        hc.close()
        dc.close()
    return {"sessions": len(dates), "first_session": dates[0], "latest_session": dates[-1]}


# ── local install (the reader's verified replica) ──────────────────────────────────────────────────
def _objects_dir(root: Optional[str] = None) -> str:
    return os.path.join(root or _root(), "objects")


def local_path(sha: str, root: Optional[str] = None) -> str:
    return os.path.join(_objects_dir(root), sha + ".db")


def _fetch(store, art: dict, root: str) -> str:
    p = local_path(art["sha256"], root)
    if os.path.isfile(p) and os.path.getsize(p) == art["bytes"] and sha_file(p) == art["sha256"]:
        return p
    blob = store.get(art["key"])
    if sha_bytes(blob) != art["gz_sha256"]:
        raise Refused("OBJECT_GZ_HASH_MISMATCH", art["key"])
    plain = gzip.decompress(blob)
    if len(plain) != art["bytes"] or sha_bytes(plain) != art["sha256"]:
        raise Refused("OBJECT_HASH_MISMATCH", art["key"])
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".partial.%d" % os.getpid()
    with open(tmp, "wb") as f:
        f.write(plain)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o444)
    os.replace(tmp, p)
    return p


def _atomic_write(path: str, body: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp.%d" % os.getpid()
    with open(tmp, "wb") as f:
        f.write(body)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def install(pointer_bytes: bytes, store, root: Optional[str] = None) -> dict:
    """Download + verify every artifact the pointer names, prove the set, then switch CURRENT atomically.
    Any refusal leaves the previously installed authority untouched (and serving)."""
    root = root or _root()
    p = parse_pointer(pointer_bytes)
    paths = {a: _fetch(store, p[a], root) for a in ("historical", "derived", "live")}
    view = verify_set(p, paths["historical"], paths["derived"], paths["live"])
    cur = os.path.join(root, "CURRENT.json")
    psha = sha_bytes(pointer_bytes)
    _atomic_write(os.path.join(root, "history", "%06d-%s.json" % (p["publication_version"], psha[:12])),
                  pointer_bytes)
    if os.path.exists(cur):
        old = open(cur, "rb").read()
        if sha_bytes(old) == psha:
            return {"result": "same", "publication_version": p["publication_version"], **view}
        _atomic_write(os.path.join(root, "PREVIOUS.json"), old)
    _atomic_write(cur, pointer_bytes)                           # ⭐ THE switch: one rename
    _VIEW.update(stat=None)
    return {"result": "installed", "publication_version": p["publication_version"], "pointer_sha256": psha, **view}


# ── the served view ────────────────────────────────────────────────────────────────────────────────
_LOCK = threading.RLock()
_VIEW: dict = {"stat": None, "data": None, "error": None}
_MEMO: dict = {}
_SYNC: dict = {"last": None, "at": None}


def _view() -> Optional[dict]:
    """The installed, verified authority (paths + pointer), or None (and `error`) — never unverified."""
    cur = os.path.join(_root(), "CURRENT.json")
    try:
        st = os.stat(cur)
    except OSError:
        _VIEW.update(stat=None, data=None, error="no authority installed")
        return None
    k = (st.st_ino, st.st_size, st.st_mtime_ns)
    with _LOCK:
        if _VIEW["stat"] == k:
            return _VIEW["data"]
        data, err = None, None
        try:
            b = open(cur, "rb").read()
            p = parse_pointer(b)
            paths = {a: local_path(p[a]["sha256"]) for a in ("historical", "derived", "live")}
            for a, path in paths.items():                   # cheap re-check per process; full proof at install
                if os.path.getsize(path) != p[a]["bytes"] or sha_file(path) != p[a]["sha256"]:
                    raise Refused("ARTIFACT_HASH_MISMATCH", a)
            data = {"pointer": p, "pointer_sha256": sha_bytes(b), "paths": paths}
        except Exception as e:  # noqa: BLE001
            err = "%s: %s" % (type(e).__name__, e)
        _VIEW.update(stat=k, data=data, error=err)
        _MEMO.clear()
        return data


def available() -> tuple:
    if mode() != "v1":
        return False, "BREADTH_AUTHORITY_EXCH is off"
    v = _view()
    return (v is not None), (None if v else _VIEW["error"])


def serves(universe: Optional[str]) -> bool:
    return (universe or "").strip().lower() in UNIVERSES and available()[0]


def token() -> str:
    """'' when off (every cache key byte-identical to before); else the installed pointer identity."""
    if mode() != "v1":
        return ""
    v = _view()
    return ":exch-" + (v["pointer_sha256"][:12] if v else "unavailable")


def _rows(universe: str, metric: str) -> dict:
    """{date: (o, h, l, c, source)}: frozen ≤ FROZEN_END + live > FROZEN_END. Memoised per pointer."""
    v = _view()
    if v is None:
        return {}
    k = ("rows", v["pointer_sha256"], universe, metric)
    hit = _MEMO.get(k)
    if hit is None:
        hit = {}
        for path, cond in ((v["paths"]["historical"], "date<=?"), (v["paths"]["live"], "date>?")):
            c = _ro(path)
            try:
                for d, o, h, l, cl, s in c.execute(
                        "SELECT date, o, h, l, c, source FROM breadth_daily_ohlc WHERE universe=? AND metric=? AND "
                        + cond, (universe, metric, FROZEN_END)):
                    if d >= START[universe]:
                        hit[d] = (o, h, l, cl, s)
            finally:
                c.close()
        if len(_MEMO) > 120:
            _MEMO.clear()
        _MEMO[k] = hit
    return hit


def universe_history(metric: str, universe: Optional[str], limit: int = 6000,
                     with_source: bool = False) -> Optional[dict]:
    """`breadth_daily_ohlc.history` for nyse/nasdaq under this authority; None when not in force (callers
    keep their old path); {} when in force but unavailable (FAIL CLOSED) or the metric has no rows."""
    u = (universe or "").strip().lower()
    if u not in UNIVERSES or mode() != "v1":
        return None
    rows = _rows(u, metric)
    keep = sorted(rows)[-int(limit):] if limit else sorted(rows)
    out = {d: {"o": rows[d][0], "h": rows[d][1], "l": rows[d][2], "c": rows[d][3]} for d in keep}
    if with_source:
        for d in keep:
            out[d]["src"] = rows[d][4]
    return out


def universe_dates(universe: Optional[str], since: str = "") -> Optional[list]:
    u = (universe or "").strip().lower()
    if u not in UNIVERSES or mode() != "v1":
        return None
    return sorted(d for d in _rows(u, "universe_count") if d >= (since or ""))


def derived(series_id: str) -> Optional[dict]:
    """{date: value} for NYSE:AD|MCO|MCS / NASDAQ:… (frozen + live); None if not an exchange series or
    the authority is not serving. MCO/MCS have no value inside the burn-in (absent, never 0)."""
    sid = (series_id or "").strip().upper()
    X, _, kind = sid.partition(":")
    if X not in ("NYSE", "NASDAQ") or kind not in DERIVED_KINDS:
        return None
    if not serves(X.lower()):
        return None
    v = _view()
    k = ("derived", v["pointer_sha256"], sid)
    hit = _MEMO.get(k)
    if hit is None:
        hit = {}
        for path, cond in ((v["paths"]["derived"], "date<=?"), (v["paths"]["live"], "date>?")):
            c = _ro(path)
            try:
                for d, val in c.execute("SELECT date, value FROM derived_series WHERE series=? AND " + cond,
                                        (sid, FROZEN_END)):
                    if val is not None:
                        hit[d] = val
            finally:
                c.close()
        _MEMO[k] = hit
    return dict(hit)


# ── status / sync ──────────────────────────────────────────────────────────────────────────────────
def status() -> dict:
    ok, why = available()
    v = _view() if mode() == "v1" else None
    p = (v or {}).get("pointer") or {}
    prev = os.path.join(_root(), "PREVIOUS.json")
    try:
        prev_doc = json.loads(open(prev, "rb").read()) if os.path.exists(prev) else None
    except Exception:  # noqa: BLE001
        prev_doc = None
    return {"mode": mode(), "available": ok, "unavailable_reason": why, "root": _root(),
            "pointer_sha256": (v or {}).get("pointer_sha256"),
            "publication_version": p.get("publication_version"), "published_at": p.get("published_at"),
            "rollback_of": p.get("rollback_of"), "latest_session": (p.get("live") or {}).get("latest_session"),
            "session_count": (p.get("live") or {}).get("session_count"),
            "live_logical_sha256": (p.get("live") or {}).get("logical_sha256"),
            "lineage": p.get("lineage"),
            "frozen": {"historical": HIST_SHA256, "derived": DER_SHA256, "frozen_end": FROZEN_END,
                       "starts": START, "mco_first": MCO_FIRST},
            "previous_publication_version": (prev_doc or {}).get("publication_version"),
            "last_sync": _SYNC["last"], "last_sync_at": _SYNC["at"], "token": token()}


def sync_once(store=None) -> dict:
    """Adopt the published pointer if it differs from the installed one. Never raises."""
    try:
        store = store or object_store()
        if store is None:
            res = {"ok": False, "reason": "no-credentials"}
        else:
            b = store.get(key(POINTER_KEY))
            res = {"ok": True, **install(b, store)}
    except Refused as e:
        res = {"ok": False, "reason": e.reason, "detail": e.detail}
    except Exception as e:  # noqa: BLE001
        res = {"ok": False, "reason": "%s: %s" % (type(e).__name__, e)}
    _SYNC.update(last=res, at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    return res


def sync_loop(interval: int = 600) -> None:
    """Web background thread (never from a request): follow the pointer."""
    while True:
        r = sync_once()
        if not r.get("ok"):
            print("[breadth_exchange_authority] sync: %s" % r, flush=True)
        time.sleep(interval)
