"""COV-02 (screen the OPTION, not the stock) and COV-03 (market-wide unusual option
volume + IV percentile), read ONLY from OUR OWN options log.

WHERE THE DATA COMES FROM
  `api/services/options_universe_log.py` records Massive's universe-wide options
  snapshot once a trading day after the close (R2 `options_log/<YYYY>/<date>.*`):
  a per-contract file (~108 MB gz, ~2M rows: strike, expiry, type, OI, IV, vendor
  greeks, bid/ask, day volume) and a per-underlying summary (ATM IV, ~80 KB).
  Massive sells no historical chains, IV or OI, so nothing here is backfilled from
  a vendor: a session the log did not record is a gap, stated, never interpolated.

THE BATCHED STEP (never on web, never per request)
  `build_session(contracts_gz, session, out_dir)` reads one day's contracts file ONCE
  and writes two derived files beside it in R2:
    * `<date>.volume.csv.gz`   -- per underlying: total / call / put option volume.
                                  This is the history the unusual-volume ratio reads
                                  (the log's own `day.volume`, so the flow tape is not
                                  needed for it).
    * `<date>.screen.sqlite.gz` -- the screenable contracts, one row each, with DTE,
                                  OTM %, |delta| and spread % precomputed and indexed.
  The terminal-next-monitor job `options-screen` (weekdays 16:30 ET, queued right
  after `options-log` in the same cron firing) builds every logged session that has
  no derived files yet -- so a missed day, or the sessions logged before this lane,
  catch up on the next run (`catch_up`).

THE REQUEST PATH (web)
  * The screener runs SQL against the LATEST session's prebuilt, indexed SQLite file,
    mirrored once per session; results are cached per (session, query).
  * The rankings read the small per-session files (volume + summary) and are cached
    per set-of-sessions: one computation per new session, not per request.

⛔ EVERY ROW NAMES ITS SESSION AND SAYS IT IS END-OF-DAY. The screen is the close-of-
  session snapshot, not a live chain; the payload says so on every row.
⛔ NO RATIO BELOW 10 SESSIONS. Unusual volume = today's option volume / the mean of the
  underlying's own prior logged sessions (up to 90). With fewer than
  `VOLUME_MIN_SESSIONS` prior sessions the row says "n sessions, needs 10", never a
  number.
⛔ NO PERCENTILE BELOW 20 SESSIONS. Today's ATM IV is ranked inside the symbol's own
  logged history only from `iv_history.RANK_MIN_SESSIONS` sessions read under the
  current rule; until then the view states the count and the date it becomes
  available.
⛔ READ-ONLY. Nothing here places, stages or simulates a trade.
⛔ DARK behind `OPTIONS_SCREENER_ENABLED` (read per call, unset = OFF) -- web routes,
  the auth payload key, and the monitor job.
"""
from __future__ import annotations

import csv
import datetime as _dt
import gzip
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import time
from typing import Callable, Optional

from api.services.research import iv_history

FLAG = "OPTIONS_SCREENER_ENABLED"
VOLUME_MIN_SESSIONS = 10
VOLUME_WINDOW = 90
IV_MIN_SESSIONS = iv_history.RANK_MIN_SESSIONS
MAX_ROWS = 200
MAX_UNDERLYINGS = 50
NOT_COMPUTABLE_LISTED = 200
DATA_BASIS = "end-of-day snapshot"
SOURCE = ("UCT options log (Massive /v3/snapshot?type=options, recorded once a trading "
          "day after the close)")
SCREEN_RULE = ("A contract is in the screen file when it has an ask, open interest or "
               "volume; contracts with none of the three are left out at build time.")
VOLUME_METHOD = ("Unusual volume = the underlying's total option volume this session "
                 "divided by the mean of its own prior logged sessions (up to 90). "
                 f"Ranked only with at least {VOLUME_MIN_SESSIONS} prior sessions.")
IV_METHOD = ("IV percentile = the share of the symbol's own prior logged sessions whose "
             "ATM IV was below this session's. " + iv_history.METHOD +
             f" Ranked only with at least {IV_MIN_SESSIONS} sessions.")

_VOL_KEY_RE = re.compile(
    r"options_log/\d{4}/(\d{4}-\d{2}-\d{2})\."
    r"(manifest\.json|underlyings\.csv\.gz|volume\.csv\.gz|screen\.sqlite\.gz)$")

VOLUME_FIELDS = ("underlying", "volume", "call_volume", "put_volume", "contracts",
                 "contracts_traded")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(FLAG, "").strip().lower() in ("1", "true", "yes", "on")


def derived_keys(session: str) -> dict:
    base = f"options_log/{session[:4]}/{session}"
    return {"volume": f"{base}.volume.csv.gz", "screen": f"{base}.screen.sqlite.gz"}


# ── the batched step ────────────────────────────────────────────────────────────

def _f(v):
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


_SCHEMA = """
CREATE TABLE contracts (
  contract TEXT NOT NULL, underlying TEXT NOT NULL, expiration TEXT NOT NULL,
  dte INTEGER NOT NULL, type TEXT NOT NULL, strike REAL NOT NULL,
  underlying_price REAL, otm_pct REAL, iv REAL, delta REAL, abs_delta REAL,
  bid REAL, ask REAL, mid REAL, spread_pct REAL, last REAL,
  open_interest INTEGER, volume INTEGER
);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
"""
_INDEXES = ("underlying", "dte", "iv", "open_interest", "volume")


def contract_values(r: dict, session: _dt.date) -> Optional[tuple]:
    """One contracts-file row -> one screen row (a tuple in `_SCHEMA` order), or
    None when it cannot be placed (no expiry/strike/type) or has no market at all."""
    typ = r.get("type")
    strike = _f(r.get("strike"))
    if typ not in ("call", "put") or strike is None or not r.get("expiration") or not r.get("underlying"):
        return None
    try:
        dte = (_dt.date.fromisoformat(r["expiration"]) - session).days
    except ValueError:
        return None
    if dte < 0:
        return None
    oi, vol = _f(r.get("open_interest")), _f(r.get("volume"))
    bid, ask = _f(r.get("bid")), _f(r.get("ask"))
    if not ((ask or 0) > 0 or (oi or 0) > 0 or (vol or 0) > 0):
        return None
    px = _f(r.get("underlying_price"))
    otm = None
    if px:
        otm = (strike - px) / px * 100 if typ == "call" else (px - strike) / px * 100
        otm = round(otm, 3)
    mid = spread = None
    if bid is not None and ask is not None and bid > 0 and ask >= bid:
        mid = (bid + ask) / 2
        spread = round((ask - bid) / mid * 100, 3)
    delta = _f(r.get("delta"))
    return (r["contract"], r["underlying"], r["expiration"], dte, typ, strike, px, otm,
            _f(r.get("iv")), delta, abs(delta) if delta is not None else None,
            bid, ask, round(mid, 4) if mid is not None else None, spread, _f(r.get("last")),
            int(oi) if oi is not None else None, int(vol) if vol is not None else None)


def build_session(contracts_gz_path: str, session: _dt.date, out_dir: str) -> dict:
    """Read ONE day's contracts file once; write `volume.csv.gz` and `screen.sqlite.gz`
    into `out_dir`. Returns the receipt (paths + counts)."""
    vol: dict = {}
    db_path = os.path.join(out_dir, "screen.sqlite")
    if os.path.exists(db_path):
        os.remove(db_path)
    con = sqlite3.connect(db_path)
    con.executescript(_SCHEMA)
    rows_in = kept = 0
    batch: list = []
    ins = f"INSERT INTO contracts VALUES ({','.join('?' * 18)})"
    with gzip.open(contracts_gz_path, "rt", newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows_in += 1
            und = r.get("underlying")
            if und:
                s = vol.setdefault(und, [0, 0, 0, 0, 0])
                v = _f(r.get("volume")) or 0
                s[0] += v
                if r.get("type") == "call":
                    s[1] += v
                elif r.get("type") == "put":
                    s[2] += v
                s[3] += 1
                s[4] += v > 0
            t = contract_values(r, session)
            if t is None:
                continue
            kept += 1
            batch.append(t)
            if len(batch) >= 20000:
                con.executemany(ins, batch)
                batch.clear()
    if batch:
        con.executemany(ins, batch)
    for col in _INDEXES:
        con.execute(f"CREATE INDEX ix_{col} ON contracts({col})")
    meta = {"session": session.isoformat(), "rows_in": rows_in, "rows_kept": kept,
            "built_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}
    con.executemany("INSERT INTO meta VALUES (?, ?)", [(k, str(v)) for k, v in meta.items()])
    con.commit()
    con.close()
    screen_gz = db_path + ".gz"
    with open(db_path, "rb") as src, gzip.open(screen_gz, "wb", compresslevel=6) as dst:
        shutil.copyfileobj(src, dst, 1 << 20)
    os.remove(db_path)
    vol_path = os.path.join(out_dir, "volume.csv.gz")
    with gzip.open(vol_path, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(VOLUME_FIELDS)
        for und in sorted(vol):
            s = vol[und]
            w.writerow([und, int(s[0]), int(s[1]), int(s[2]), s[3], s[4]])
    return {**meta, "underlyings": len(vol), "volume_path": vol_path, "screen_path": screen_gz}


def catch_up(*, list_keys: Callable[[], list], download: Callable[[str, str], None],
             upload: Callable[[str, str, str], None], workdir: Optional[str] = None,
             limit: int = 5) -> dict:
    """Build the derived files for every logged session that lacks them (newest
    first, at most `limit` per run). Never raises on one bad day: it is named."""
    keys = set(list_keys())
    logged = sorted({m.group(1) for k in keys
                     for m in [re.search(r"options_log/\d{4}/(\d{4}-\d{2}-\d{2})\.contracts\.csv\.gz$", k)]
                     if m}, reverse=True)
    todo = [d for d in logged if derived_keys(d)["volume"] not in keys
            or derived_keys(d)["screen"] not in keys][:limit]
    built, failed = [], []
    for d in todo:
        tmp = tempfile.mkdtemp(prefix="options_screen_", dir=workdir)
        try:
            src = os.path.join(tmp, "contracts.csv.gz")
            download(f"options_log/{d[:4]}/{d}.contracts.csv.gz", src)
            rec = build_session(src, _dt.date.fromisoformat(d), tmp)
            k = derived_keys(d)
            upload(rec["volume_path"], k["volume"], "application/gzip")
            upload(rec["screen_path"], k["screen"], "application/gzip")
            built.append({"session": d, "rows_kept": rec["rows_kept"], "rows_in": rec["rows_in"],
                          "underlyings": rec["underlyings"]})
        except Exception as e:  # noqa: BLE001 -- named in the receipt, never swallowed
            failed.append({"session": d, "error": f"{type(e).__name__}: {e}"})
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return {"logged": len(logged), "built": built, "failed": failed,
            "pending": max(0, len([d for d in logged if derived_keys(d)["volume"] not in keys
                                   or derived_keys(d)["screen"] not in keys]) - len(todo))}


def run_catch_up() -> dict:
    """Production wiring for the monitor: R2 list/download/upload."""
    from api import flow_backup
    client, bucket = flow_backup._r2_client(), flow_backup._bucket()
    if client is None or not bucket:
        raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")

    def list_keys():
        out = []
        for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="options_log/"):
            out.extend(o["Key"] for o in page.get("Contents") or [])
        return out

    return catch_up(list_keys=list_keys,
                    download=lambda key, path: client.download_file(bucket, key, path),
                    upload=lambda path, key, ct: client.upload_file(
                        path, bucket, key, ExtraArgs={"ContentType": ct}))


def receipt_text(rec: dict) -> tuple:
    """(title, body, alert) for the monitor's post."""
    built = ", ".join(f"{b['session']} ({b['rows_kept']:,} of {b['rows_in']:,} contracts)"
                      for b in rec["built"]) or "nothing new"
    body = f"Built: {built}. {rec['logged']} logged sessions; {rec['pending']} still pending."
    if rec["failed"]:
        body += " FAILED: " + "; ".join(f"{f['session']}: {f['error']}" for f in rec["failed"])
        return ("Options screen: FAILED", body, True)
    return ("Options screen: built", body, False)


# ── the store (web) ─────────────────────────────────────────────────────────────

class LocalStore(iv_history.LocalStore):
    """The log's layout on local disk, plus the derived files."""

    def volume_path(self, session: str) -> Optional[str]:
        p = os.path.join(self.root, "options_log", session[:4], f"{session}.volume.csv.gz")
        return p if os.path.exists(p) else None

    def volume_sessions(self) -> list:
        base = os.path.join(self.root, "options_log")
        out = []
        if os.path.isdir(base):
            for year in os.listdir(base):
                ydir = os.path.join(base, year)
                if os.path.isdir(ydir):
                    out += [m.group(1) for n in os.listdir(ydir)
                            for m in [re.match(r"^(\d{4}-\d{2}-\d{2})\.volume\.csv\.gz$", n)] if m]
        return sorted(out)

    def screen_sessions(self) -> list:
        base = os.path.join(self.root, "options_log")
        out = []
        if os.path.isdir(base):
            for year in os.listdir(base):
                ydir = os.path.join(base, year)
                if os.path.isdir(ydir):
                    out += [m.group(1) for n in os.listdir(ydir)
                            for m in [re.match(r"^(\d{4}-\d{2}-\d{2})\.screen\.sqlite(\.gz)?$", n)] if m]
        return sorted(set(out))

    def screen_db(self, session: str) -> Optional[str]:
        """Path to the session's SQLite file, decompressing the .gz once."""
        ydir = os.path.join(self.root, "options_log", session[:4])
        db = os.path.join(ydir, f"{session}.screen.sqlite")
        gz = db + ".gz"
        if os.path.exists(gz) and (not os.path.exists(db) or os.path.getmtime(gz) > os.path.getmtime(db)):
            tmp = db + ".part"
            with gzip.open(gz, "rb") as src, open(tmp, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            os.replace(tmp, db)
        return db if os.path.exists(db) else None

    def signature(self) -> tuple:
        """Changes when a session or a derived file lands (the cache key)."""
        return (tuple(sorted(self.sessions())), tuple(self.volume_sessions()),
                tuple(self.screen_sessions()))


class R2Store(LocalStore):
    """Mirrors the small per-session files (manifest, summary, volume) from R2 and
    fetches ONE session's screen file on demand. Listing cached `LIST_TTL_S`."""

    LIST_TTL_S = 600

    def __init__(self, cache_dir: Optional[str] = None):
        super().__init__(cache_dir or os.environ.get("OPTIONS_SCREENER_CACHE_DIR")
                         or os.path.join(tempfile.gettempdir(), "uct_options_screener"))
        self._lock = threading.Lock()
        self._listed_at = 0.0
        self._etags: dict = {}
        self._screen_keys: dict = {}

    def _client(self):
        from api import flow_backup
        client, bucket = flow_backup._r2_client(), flow_backup._bucket()
        if client is None or not bucket:
            raise RuntimeError("DATA_SYNC_* R2 credentials are not set on this service")
        return client, bucket

    def _fetch(self, client, bucket, key, etag) -> None:
        local = os.path.join(self.root, *key.split("/"))
        if self._etags.get(key) == etag and os.path.exists(local):
            return
        os.makedirs(os.path.dirname(local), exist_ok=True)
        client.download_file(bucket, key, local + ".part")
        os.replace(local + ".part", local)
        self._etags[key] = etag

    def _sync(self) -> None:
        with self._lock:
            if self._listed_at and time.monotonic() - self._listed_at < self.LIST_TTL_S:
                return
            client, bucket = self._client()
            screens = {}
            for page in client.get_paginator("list_objects_v2").paginate(
                    Bucket=bucket, Prefix="options_log/"):
                for o in page.get("Contents") or []:
                    m = _VOL_KEY_RE.search(o["Key"])
                    if not m:
                        continue
                    if m.group(2) == "screen.sqlite.gz":
                        screens[m.group(1)] = (o["Key"], o.get("ETag", ""))
                    else:
                        self._fetch(client, bucket, o["Key"], o.get("ETag", ""))
            self._screen_keys = screens
            self._listed_at = time.monotonic()

    def sessions(self) -> dict:
        self._sync()
        return super().sessions()

    def screen_sessions(self) -> list:
        self._sync()
        return sorted(self._screen_keys)

    def screen_db(self, session: str) -> Optional[str]:
        self._sync()
        hit = self._screen_keys.get(session)
        if hit is None:
            return None
        with self._lock:
            client, bucket = self._client()
            self._fetch(client, bucket, hit[0], hit[1])
        return super().screen_db(session)


_store_override: Optional[LocalStore] = None
_default_store: Optional[R2Store] = None


def get_store() -> LocalStore:
    """Tests set `_store_override` to a seeded LocalStore; production reads R2."""
    global _default_store
    if _store_override is not None:
        return _store_override
    if _default_store is None:
        _default_store = R2Store()
    return _default_store


# ── COV-02: the option screener ────────────────────────────────────────────────

#: param -> (column, op). abs_delta is |delta|; iv is percent in the API.
_RANGE = {
    "dte_min": ("dte", ">="), "dte_max": ("dte", "<="),
    "otm_min": ("otm_pct", ">="), "otm_max": ("otm_pct", "<="),
    "delta_min": ("abs_delta", ">="), "delta_max": ("abs_delta", "<="),
    "spread_max": ("spread_pct", "<="),
    "oi_min": ("open_interest", ">="), "volume_min": ("volume", ">="),
    "iv_min": ("iv", ">="), "iv_max": ("iv", "<="),
    "bid_min": ("bid", ">="), "ask_max": ("ask", "<="),
}
#: The column a filter reads -> the sentence for a contract that lacks it.
_CAUSE = {
    "otm_pct": "no underlying price in the snapshot",
    "abs_delta": "no vendor delta",
    "spread_pct": "no two-sided quote",
    "iv": "no vendor IV",
    "bid": "no bid", "ask": "no ask",
    "open_interest": "no open interest reported",
    "volume": "no volume reported",
}
_SORTS = {"iv", "volume", "open_interest", "spread_pct", "abs_delta", "dte", "otm_pct",
          "ask", "underlying"}
_SYM = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

PRESETS = {
    "high_iv_short_premium": {
        "label": "High-IV short-premium candidates",
        "description": ("Out-of-the-money contracts 14-60 days out at 15-35 |delta|, IV of "
                        "60% or more, a bid of at least $0.20, spread at most 10% and open "
                        "interest of 500+. Sorted by IV."),
        "params": {"dte_min": 14, "dte_max": 60, "delta_min": 0.15, "delta_max": 0.35,
                   "otm_min": 0, "iv_min": 60, "bid_min": 0.20, "spread_max": 10,
                   "oi_min": 500, "sort": "iv", "order": "desc"},
    },
    "cheap_far_otm_calls": {
        "label": "Cheap far-OTM calls",
        "description": ("Calls 15-50% out of the money, 14-90 days out, asking $0.50 or "
                        "less, with open interest of 100+. Sorted by today's volume."),
        "params": {"type": "call", "otm_min": 15, "otm_max": 50, "dte_min": 14, "dte_max": 90,
                   "ask_max": 0.50, "oi_min": 100, "sort": "volume", "order": "desc"},
    },
    "tight_spread_liquid": {
        "label": "Tight-spread liquid contracts",
        "description": ("Spread of 2% of the mid or less, open interest of 5,000+ and "
                        "1,000+ contracts traded today. Sorted by volume."),
        "params": {"spread_max": 2, "oi_min": 5000, "volume_min": 1000,
                   "sort": "volume", "order": "desc"},
    },
}


class BadQuery(ValueError):
    """A screen parameter that cannot be read; the route answers 422 with the words."""


def normalize_query(raw: dict) -> dict:
    """Validate and canonicalise. Unknown keys are refused, not ignored."""
    raw = dict(raw or {})
    preset = raw.pop("preset", None) or None
    if preset is not None:
        if preset not in PRESETS:
            raise BadQuery(f"unknown preset {preset!r}")
        # the member's own values override the preset's
        raw = {**PRESETS[preset]["params"], **{k: v for k, v in raw.items() if v not in (None, "")}}
    q: dict = {"preset": preset} if preset else {}
    for k, v in raw.items():
        if v is None or v == "":
            continue
        if k in _RANGE:
            try:
                q[k] = float(v)
            except (TypeError, ValueError):
                raise BadQuery(f"{k} must be a number")
        elif k == "type":
            if v not in ("call", "put", "any"):
                raise BadQuery("type must be call, put or any")
            if v != "any":
                q[k] = v
        elif k == "underlyings":
            syms = sorted({s.strip().upper() for s in str(v).split(",") if s.strip()})
            bad = [s for s in syms if not _SYM.match(s)]
            if bad:
                raise BadQuery(f"not a ticker symbol: {', '.join(bad[:5])}")
            if len(syms) > MAX_UNDERLYINGS:
                raise BadQuery(f"at most {MAX_UNDERLYINGS} underlyings per screen")
            if syms:
                q[k] = syms
        elif k == "sort":
            if v not in _SORTS:
                raise BadQuery(f"sort must be one of {', '.join(sorted(_SORTS))}")
            q[k] = v
        elif k == "order":
            if v not in ("asc", "desc"):
                raise BadQuery("order must be asc or desc")
            q[k] = v
        elif k == "limit":
            try:
                q[k] = max(1, min(MAX_ROWS, int(v)))
            except (TypeError, ValueError):
                raise BadQuery("limit must be a whole number")
        else:
            raise BadQuery(f"unknown screen parameter {k!r}")
    return q


def _where(q: dict) -> tuple:
    scope, scope_args = [], []
    if q.get("underlyings"):
        scope.append(f"underlying IN ({','.join('?' * len(q['underlyings']))})")
        scope_args += q["underlyings"]
    preds, args, read_cols = [], [], []
    if q.get("type"):
        preds.append("type = ?")
        args.append(q["type"])
    for k, (col, op) in _RANGE.items():
        if k not in q:
            continue
        v = q[k] / 100.0 if col == "iv" else q[k]
        preds.append(f"{col} {op} ?")
        args.append(v)
        if col not in read_cols and col in _CAUSE:
            read_cols.append(col)
    return scope, scope_args, preds, args, read_cols


_ROW_COLS = ("contract", "underlying", "expiration", "dte", "type", "strike",
             "underlying_price", "otm_pct", "iv", "delta", "bid", "ask", "mid",
             "spread_pct", "last", "open_interest", "volume")

_SCREEN_CACHE: dict = {}
_SCREEN_CACHE_MAX = 256
_cache_lock = threading.Lock()


def screen(raw: dict, *, store: Optional[LocalStore] = None) -> dict:
    """Run one screen over the LATEST session that has a screen file."""
    store = store or get_store()
    q = normalize_query(raw)
    sessions = store.screen_sessions()
    base = {"source": SOURCE, "data_basis": DATA_BASIS, "screen_rule": SCREEN_RULE,
            "query": q, "presets": {k: {"label": p["label"], "description": p["description"]}
                                    for k, p in PRESETS.items()}}
    if not sessions:
        return {**base, "status": "no_screen", "session": None, "rows": [], "matched": 0,
                "coverage": None,
                "note": ("No session's screen file has been built yet. The options log is "
                         "screened after the close, once the options-screen job runs.")}
    session = sessions[-1]
    ck = (session, repr(sorted(q.items())))
    with _cache_lock:
        if ck in _SCREEN_CACHE:
            return _SCREEN_CACHE[ck]
    path = store.screen_db(session)
    if path is None:
        raise RuntimeError(f"the screen file for {session} could not be read")
    scope, sargs, preds, pargs, read_cols = _where(q)
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        sw = " AND ".join(scope) or "1=1"
        evaluated = con.execute(f"SELECT COUNT(*) FROM contracts WHERE {sw}", sargs).fetchone()[0]
        missing_any = " OR ".join(f"{c} IS NULL" for c in read_cols)
        not_comp = 0
        listed: list = []
        if missing_any:
            not_comp = con.execute(f"SELECT COUNT(*) FROM contracts WHERE {sw} AND ({missing_any})",
                                   sargs).fetchone()[0]
            cols = ", ".join(read_cols)
            for rec in con.execute(f"SELECT contract, {cols} FROM contracts WHERE {sw} AND "
                                   f"({missing_any}) LIMIT {NOT_COMPUTABLE_LISTED}", sargs):
                first = next(c for c, v in zip(read_cols, rec[1:]) if v is None)
                listed.append({"ticker": rec[0], "reason": "not-computable", "detail": _CAUSE[first]})
        pw = " AND ".join(scope + preds) or "1=1"
        matched = con.execute(f"SELECT COUNT(*) FROM contracts WHERE {pw}", sargs + pargs).fetchone()[0]
        sort = q.get("sort", "volume")
        order = q.get("order", "desc").upper()
        limit = q.get("limit", MAX_ROWS)
        rows = []
        for rec in con.execute(
                f"SELECT {', '.join(_ROW_COLS)} FROM contracts WHERE {pw} "
                f"ORDER BY {sort} IS NULL, {sort} {order}, contract LIMIT {int(limit)}",
                sargs + pargs):
            d = dict(zip(_ROW_COLS, rec))
            d["session"] = session
            d["data_basis"] = DATA_BASIS
            rows.append(d)
        meta = dict(con.execute("SELECT k, v FROM meta").fetchall())
    finally:
        con.close()
    out = {**base, "status": "ok", "session": session, "matched": matched, "rows": rows,
           "shown": len(rows), "file_rows": int(meta.get("rows_kept", 0) or 0),
           "logged_rows": int(meta.get("rows_in", 0) or 0),
           "coverage": {"evaluated": evaluated, "answered": evaluated - not_comp, "dropped": 0,
                        "not_computable": not_comp, "dropped_symbols": listed},
           "note": (f"End-of-day snapshot of {session}: these are the close-of-session "
                    "quotes and greeks, not a live chain.")}
    with _cache_lock:
        if len(_SCREEN_CACHE) >= _SCREEN_CACHE_MAX:
            _SCREEN_CACHE.clear()
        _SCREEN_CACHE[ck] = out
    return out


# ── COV-03: the rankings ────────────────────────────────────────────────────────

_FILE_CACHE: dict = {}


def _read_csv(path: str) -> list:
    stamp = os.path.getmtime(path)
    hit = _FILE_CACHE.get(path)
    if hit and hit[0] == stamp:
        return hit[1]
    with gzip.open(path, "rt", newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        legacy = "atm_dte" not in (reader.fieldnames or []) and "atm_iv" in (reader.fieldnames or [])
        rows = list(reader)
    for r in rows:
        r["_legacy"] = legacy
    _FILE_CACHE[path] = (stamp, rows)
    return rows


def ranking_available_on(after_session: str, more: int) -> Optional[str]:
    """The session on which `more` further logged sessions after `after_session`
    would exist, if every trading day from here is logged. 0 -> None."""
    if more <= 0:
        return None
    d = _dt.date.fromisoformat(after_session)
    for _ in range(more):
        d = iv_history._next_trading_day(d)
    return d.isoformat()


def _missing(first: str, have: list, now) -> list:
    return [d for d in iv_history.expected_sessions(first, now) if d not in set(have)]


def unusual_volume(*, store: Optional[LocalStore] = None, now=None, limit: int = MAX_ROWS) -> dict:
    store = store or get_store()
    sessions = store.volume_sessions()
    base = {"source": SOURCE, "data_basis": DATA_BASIS, "method": VOLUME_METHOD,
            "min_sessions": VOLUME_MIN_SESSIONS, "window": VOLUME_WINDOW}
    if not sessions:
        return {**base, "status": "no_log", "session": None, "sessions_logged": 0,
                "ranked": [], "not_ranked": [], "coverage": None, "missing_sessions": [],
                "available_on": None,
                "note": "No session's option volume has been derived from the log yet."}
    latest = sessions[-1]
    prior = sessions[:-1][-VOLUME_WINDOW:]
    today = {r["underlying"]: r for r in _read_csv(store.volume_path(latest))}
    hist: dict = {}
    for d in prior:
        for r in _read_csv(store.volume_path(d)):
            hist.setdefault(r["underlying"], []).append(float(r["volume"] or 0))
    ranked, not_ranked, listed = [], [], []
    for und, r in today.items():
        v = float(r["volume"] or 0)
        h = hist.get(und, [])
        n = len(h)
        row = {"underlying": und, "session": latest, "data_basis": DATA_BASIS,
               "volume": int(v), "call_volume": int(float(r["call_volume"] or 0)),
               "put_volume": int(float(r["put_volume"] or 0)), "n_sessions": n}
        if n < VOLUME_MIN_SESSIONS:
            row["note"] = f"{n} session{'s' if n != 1 else ''}, needs {VOLUME_MIN_SESSIONS}"
            not_ranked.append(row)
            listed.append({"ticker": und, "reason": "not-computable", "detail": row["note"]})
            continue
        avg = sum(h) / n
        if avg <= 0:
            row["note"] = f"no option volume in its {n} prior sessions"
            not_ranked.append(row)
            listed.append({"ticker": und, "reason": "not-computable", "detail": row["note"]})
            continue
        row["average"] = round(avg, 1)
        row["ratio"] = round(v / avg, 2)
        ranked.append(row)
    ranked.sort(key=lambda r: (-r["ratio"], -r["volume"], r["underlying"]))
    not_ranked.sort(key=lambda r: (-r["volume"], r["underlying"]))
    most = max((r["n_sessions"] for r in not_ranked), default=len(prior))
    return {**base, "status": "ok", "session": latest, "sessions_logged": len(sessions),
            "prior_sessions": len(prior), "ranked": ranked[:limit], "ranked_total": len(ranked),
            "not_ranked": not_ranked[:limit], "not_ranked_total": len(not_ranked),
            "missing_sessions": _missing(sessions[0], sessions, now),
            "available_on": (ranking_available_on(latest, VOLUME_MIN_SESSIONS - most)
                             if not ranked else None),
            "coverage": {"evaluated": len(today), "answered": len(ranked), "dropped": 0,
                         "not_computable": len(not_ranked), "dropped_symbols": listed[:NOT_COMPUTABLE_LISTED]},
            "note": None if ranked else (
                f"{len(prior)} prior session{'s' if len(prior) != 1 else ''} logged; the ratio needs "
                f"{VOLUME_MIN_SESSIONS}.")}


def bucket(pct: float) -> str:
    if pct < 20:
        return "very low"
    if pct < 40:
        return "low"
    if pct < 60:
        return "moderate"
    if pct < 80:
        return "high"
    return "very high"


def iv_percentile(*, store: Optional[LocalStore] = None, now=None, limit: int = MAX_ROWS) -> dict:
    store = store or get_store()
    manifests = store.sessions()
    base = {"source": SOURCE, "data_basis": DATA_BASIS, "method": IV_METHOD,
            "min_sessions": IV_MIN_SESSIONS}
    if not manifests:
        return {**base, "status": "no_log", "session": None, "sessions_logged": 0,
                "rankable_sessions": 0, "ranked": [], "coverage": None, "missing_sessions": [],
                "available_on": None, "note": "The options log holds no sessions yet."}
    sessions = sorted(manifests)
    latest = sessions[-1]
    series: dict = {}
    legacy_days = []
    for d in sessions:
        path = store.summary_path(d)
        rows = _read_csv(path) if path else []
        if rows and rows[0]["_legacy"]:
            legacy_days.append(d)
            continue
        for r in rows:
            iv = _f(r.get("atm_iv"))
            if iv is not None:
                series.setdefault(r["underlying"], []).append((d, iv))
    rankable = len(sessions) - len(legacy_days)
    ranked, listed, evaluated = [], [], 0
    for und, pts in series.items():
        if pts[-1][0] != latest:
            continue
        evaluated += 1
        vals = [v for _, v in pts][-iv_history.RANK_WINDOW:]
        if len(vals) < IV_MIN_SESSIONS:
            listed.append({"ticker": und, "reason": "not-computable",
                           "detail": f"{len(vals)} session{'s' if len(vals) != 1 else ''}, needs {IV_MIN_SESSIONS}"})
            continue
        r = iv_history.rank_of(vals)
        ranked.append({"underlying": und, "session": latest, "data_basis": DATA_BASIS,
                       "atm_iv": r["current"], "iv_percentile": r["iv_percentile"],
                       "iv_rank": r["iv_rank"], "bucket": bucket(r["iv_percentile"]),
                       "n_sessions": r["window_sessions"], "low": r["low"], "high": r["high"]})
    ranked.sort(key=lambda r: (-r["iv_percentile"], r["underlying"]))
    most = max((len(p) for u, p in series.items() if p[-1][0] == latest), default=0)
    note = None
    if not ranked:
        note = (f"{rankable} session{'s' if rankable != 1 else ''} logged under the current ATM "
                f"read; the percentile needs {IV_MIN_SESSIONS}.")
        if legacy_days:
            note += (f" {', '.join(legacy_days)} {'were' if len(legacy_days) > 1 else 'was'} read "
                     "under the first run's 20-45 day rule and is not counted.")
    buckets = {}
    for r in ranked:
        buckets[r["bucket"]] = buckets.get(r["bucket"], 0) + 1
    return {**base, "status": "ok", "session": latest, "sessions_logged": len(sessions),
            "rankable_sessions": rankable, "legacy_sessions": legacy_days,
            "ranked": ranked[:limit], "ranked_total": len(ranked), "buckets": buckets,
            "missing_sessions": _missing(sessions[0], sessions, now),
            "available_on": ranking_available_on(latest, IV_MIN_SESSIONS - most) if not ranked else None,
            "coverage": {"evaluated": evaluated, "answered": len(ranked), "dropped": 0,
                         "not_computable": evaluated - len(ranked),
                         "dropped_symbols": listed[:NOT_COMPUTABLE_LISTED]},
            "note": note}


_RANK_CACHE: dict = {}
_rank_lock = threading.Lock()


def cached(name: str, fn: Callable[..., dict], *, store: Optional[LocalStore] = None) -> dict:
    """One computation per (ranking, set of sessions on disk) -- a new session (or a
    newly derived file) changes the signature; requests in between read the cache."""
    store = store or get_store()
    sig = (name, id(store), store.signature())
    with _rank_lock:
        hit = _RANK_CACHE.get(name)
        if hit and hit[0] == sig:
            return hit[1]
        out = fn(store=store)
        _RANK_CACHE[name] = (sig, out)
        return out
