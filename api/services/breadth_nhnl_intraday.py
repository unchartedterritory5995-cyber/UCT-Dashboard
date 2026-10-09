"""New 52-week / 20-day highs and lows on the INTRADAY basis — the exchange convention.

⭐⭐ WHY THIS EXISTS (2026-10-09). Every other breadth count we publish is measured on the
close, and so were new highs/lows: "close >= 0.999 x the prior 252 closes' max". The
exchanges, Dow Jones / WSJ's Markets Diary and StockCharts all count a new high when the
session's HIGH trades above the prior 52-week HIGH (a new low: LOW below the prior LOW).
On 2026-10-08 — an up day on the NYSE that opened weak — WSJ printed NYSE 37 highs / 268
lows (net −231) while our closing count read 52 / 49 (net +3): names that broke to new
lows in the morning and recovered by the close are new lows to everyone else and to
nobody on a closing basis. The owner's ruling: match the convention.

⭐ ONE METHOD, ONE DATA FAMILY, HISTORY AND LIVE. Every value here comes from the
provider's split-adjusted grouped daily bars (`/v2/aggs/grouped`, `h`/`l`; extended-hours
Form-T prints do not set a consolidated high/low) plus, for today's developing row, the
snapshot's running RTH `day.h`/`day.l`. Split-adjusted and NOT dividend-adjusted —
Dow Jones/WSJ use unadjusted prices for highs/lows; a dividend never makes a new low.

    new_52w_high(D) ⟺ high(D) >  max(high over the 251 sessions before D)
    new_52w_low(D)  ⟺ low(D)  <  min(low  over the 251 sessions before D)
    new_20d_*       — the same over the 19 sessions before D
    A name counts only with a COMPLETE prior window (the same rule as every other level).

⭐ MEMBERSHIP = THE SAME RULES AS THE CANONICAL SERIES, MEASURED FROM THE SAME FRAME.
us / nyse / nasdaq: a ticker that traded on D, whose reference record on D is common
stock (CS/ADRC) with a primary listing on the universe's venues — `breadth_pit_frame`'s
classification (delisted names included: the frame IS the point-in-time market).
uct: the collector's stored `universe_list` for D (the list the PIT ledger is built from),
the nearest earlier stored list carried when a session has none.

⛔ SERVE-TIME OVERLAY, NEVER A REWRITE. The frozen V2 / Exchange artifacts are pinned and
untouched; when the basis is "intraday" the readers (`breadth_daily_ohlc.history`,
`breadth_authority.v2_rows`, the live payloads) replace these metrics for every session
this series covers, and the cache token carries the series' sha so every cache and ETag
moves with it. `BREADTH_NHNL_BASIS=close` is the kill switch (back to the stored counts).

⛔ RUNS ON THE WEB PROCESS, SO IT IS FRUGAL BY CONSTRUCTION: one grouped day at a time,
nothing written to the grouped caches (`store=False`), a ring buffer of 252 sessions
(float32) for the names seen in the last year, its own request pacing so the shared
Massive budget is never starved, and a checkpoint so a redeploy resumes, not restarts.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import threading
import time
from datetime import date as _date, timedelta as _td
from typing import Optional

import numpy as np

_log = logging.getLogger("breadth_nhnl_intraday")

VERSION = "nhnl-intraday-v1"
BASIS_TEXT = ("intraday: session high above the prior 251 sessions' highest high (low below "
              "the lowest low); split-adjusted, not dividend-adjusted; common stock")
UNIVERSES = ("uct", "us", "nyse", "nasdaq")
#: Metrics this series answers, and their stored-row positions.
COUNTS = ("new_52w_highs", "new_52w_lows", "new_20d_highs", "new_20d_lows")
SERVED = COUNTS + ("net_new_high_low", "hi_ratio", "lo_ratio")
W52 = 251            # prior sessions in a 52-week window (252 including D)
W20 = 19             # prior sessions in a 20-session window
RING = 252
#: First session fetched: one year of warm-up before the canonical history's first session
#: (2008-01-02), so 2008 is measured over a complete window.
START = "2006-12-01"
#: Request pacing (seconds between grouped calls) — at most ~75/min of the shared 300/min budget.
PACE_SECONDS = float(os.environ.get("BREADTH_NHNL_PACE", "0.8"))
#: A session is processed only once its daily bar has settled.
SETTLE_MINUTES_AFTER_CLOSE = 120

_DATA = os.environ.get("DATA_DIR", "/data")
SERIES_PATH = os.path.join(_DATA, "breadth_nhnl_intraday.json")
STATE_PATH = os.path.join(_DATA, "breadth_nhnl_intraday_state.npz")
R2_KEY = "breadth_nhnl/intraday_v1.json.gz"


#: The served basis when `BREADTH_NHNL_BASIS` is unset. ⛔ Flipped to "intraday" only after the
#: full-history series was swept and checked against the published diaries.
DEFAULT_BASIS = "close"


def basis() -> str:
    """'intraday' (serve this series), 'close' (serve the stored counts; the series is still
    maintained) or 'off' (stored counts, and no sweeping either)."""
    v = (os.environ.get("BREADTH_NHNL_BASIS") or DEFAULT_BASIS).strip().lower()
    return v if v in ("intraday", "close", "off") else DEFAULT_BASIS


# ── tickers / membership ────────────────────────────────────────────────────

def canon(t) -> str:
    return str(t or "").strip().upper().replace("-", ".").replace("/", ".")


def _uct_list(date_iso: str) -> Optional[list]:
    try:
        from api.services import breadth_monitor as bm
        items = bm.get_drill_list(date_iso, "universe_list")
    except Exception:
        return None
    out = []
    for i in items or []:
        t = i.get("t") if isinstance(i, dict) else i
        if t:
            out.append(canon(t))
    return out if len(out) >= 100 else None


class Classifier:
    """Per-session universe membership from the reference map (cached per ticker+listing)."""

    def __init__(self, ref_map: dict):
        from api.services import breadth_universes as bu
        self.ref = {canon(k): v for k, v in (ref_map or {}).items()}
        self.venues = {u: frozenset(bu.venues(u) or ()) for u in ("us", "nyse", "nasdaq")}
        self._uct_last: Optional[set] = None

    def classify(self, sym: str, date_iso: str) -> tuple:
        from api.services import breadth_pit_frame as bpf
        rec = bpf.resolve(self.ref.get(sym), date_iso)
        if rec is None or rec.get("type") not in bpf.COMMON_TYPES:
            return ()
        ex = (rec.get("primary_exchange") or "").upper()
        return tuple(u for u in ("us", "nyse", "nasdaq") if ex and ex in self.venues[u])

    def uct(self, date_iso: str) -> Optional[set]:
        lst = _uct_list(date_iso)
        if lst:
            self._uct_last = set(lst)
        return self._uct_last


# ── the ring buffer ─────────────────────────────────────────────────────────

class Ring:
    """Highs / lows / closes for the last `RING` sessions, one row per ticker."""

    def __init__(self):
        self.index: dict = {}
        self.tickers: list = []
        self.H = np.full((0, RING), np.nan, dtype=np.float32)
        self.L = np.full((0, RING), np.nan, dtype=np.float32)
        self.C = np.full((0, RING), np.nan, dtype=np.float32)
        self.n = 0              # sessions written so far
        self.dates: list = []   # the last <= RING session dates, oldest first

    def _grow(self, need: int):
        cap = self.H.shape[0]
        if need <= cap:
            return
        add = max(need - cap, 2048)
        pad = np.full((add, RING), np.nan, dtype=np.float32)
        self.H = np.vstack([self.H, pad])
        self.L = np.vstack([self.L, pad])
        self.C = np.vstack([self.C, pad.copy()])

    def rows_for(self, syms) -> np.ndarray:
        idx = []
        for s in syms:
            i = self.index.get(s)
            if i is None:
                i = len(self.tickers)
                self.index[s] = i
                self.tickers.append(s)
            idx.append(i)
        self._grow(len(self.tickers))
        return np.asarray(idx, dtype=np.int64)

    def slot(self, k: int = 0) -> int:
        """Column of the session `k` steps before the NEXT one (k=0 → the next slot)."""
        return (self.n - k) % RING

    def prior(self, rows: np.ndarray, width: int):
        """(max high, min low, complete) over the `width` sessions before the next one."""
        if self.n < width:
            z = np.full(len(rows), np.nan)
            return z, z, np.zeros(len(rows), dtype=bool)
        cols = [(self.n - k) % RING for k in range(1, width + 1)]
        h = self.H[np.ix_(rows, cols)]
        lo = self.L[np.ix_(rows, cols)]
        complete = ~np.isnan(h).any(axis=1) & ~np.isnan(lo).any(axis=1)
        with np.errstate(invalid="ignore"), _quiet():
            mx = np.nanmax(h, axis=1) if h.size else np.full(len(rows), np.nan)
            mn = np.nanmin(lo, axis=1) if lo.size else np.full(len(rows), np.nan)
        return mx, mn, complete

    def write(self, date_iso: str, rows: np.ndarray, h, lo, c):
        s = self.slot()
        self.H[:, s] = np.nan
        self.L[:, s] = np.nan
        self.C[:, s] = np.nan
        self.H[rows, s] = h
        self.L[rows, s] = lo
        self.C[rows, s] = c
        self.n += 1
        self.dates = (self.dates + [date_iso])[-RING:]

    def sma_above(self, rows: np.ndarray, c_today: np.ndarray, width: int):
        """(above, valid) for close vs the simple average of the last `width` closes INCLUDING
        today (call after `write`)."""
        if self.n < width:
            return np.zeros(len(rows), dtype=bool), np.zeros(len(rows), dtype=bool)
        cols = [(self.n - k) % RING for k in range(1, width + 1)]
        w = self.C[np.ix_(rows, cols)]
        valid = ~np.isnan(w).any(axis=1)
        with np.errstate(invalid="ignore"), _quiet():
            avg = np.nanmean(w, axis=1)
        return valid & (c_today > avg), valid

    def compact(self):
        """Drop tickers with no bar anywhere in the window (delisted > a year ago)."""
        if not self.tickers:
            return
        keep = ~np.isnan(self.H[:len(self.tickers)]).all(axis=1)
        if keep.all():
            return
        ids = np.nonzero(keep)[0]
        self.tickers = [self.tickers[i] for i in ids]
        self.index = {t: i for i, t in enumerate(self.tickers)}
        self.H, self.L, self.C = self.H[ids], self.L[ids], self.C[ids]

    # persistence
    def save(self, path: str, extra: dict):
        tmp = path + ".tmp.npz"
        np.savez_compressed(tmp, H=self.H[:len(self.tickers)], L=self.L[:len(self.tickers)],
                            C=self.C[:len(self.tickers)],
                            meta=np.frombuffer(json.dumps({
                                "tickers": self.tickers, "n": self.n, "dates": self.dates,
                                **extra}).encode(), dtype=np.uint8))
        os.replace(tmp, path)

    @classmethod
    def load(cls, path: str):
        with np.load(path) as z:
            meta = json.loads(bytes(z["meta"]).decode())
            r = cls()
            r.H, r.L, r.C = z["H"], z["L"], z["C"]
        r.tickers = meta["tickers"]
        r.index = {t: i for i, t in enumerate(r.tickers)}
        r.n, r.dates = meta["n"], meta["dates"]
        return r, meta


class _quiet:
    def __enter__(self):
        import warnings
        self._w = warnings.catch_warnings()
        self._w.__enter__()
        warnings.simplefilter("ignore", RuntimeWarning)

    def __exit__(self, *a):
        self._w.__exit__(*a)


# ── one session ─────────────────────────────────────────────────────────────

def measure(ring: Ring, date_iso: str, frame: dict, cls: Classifier) -> dict:
    """Count one settled session and advance the ring. `frame` = {TICKER: {h,l,c,v}}."""
    syms, h, lo, c = [], [], [], []
    for t, r in frame.items():
        hh, ll, cc = r.get("h"), r.get("l"), r.get("c")
        if hh is None or ll is None or cc is None or not (r.get("v") or 0) > 0:
            continue
        syms.append(canon(t))
        h.append(hh)
        lo.append(ll)
        c.append(cc)
    rows = ring.rows_for(syms)
    h = np.asarray(h, dtype=np.float32)
    lo = np.asarray(lo, dtype=np.float32)
    c = np.asarray(c, dtype=np.float32)
    mx52, mn52, ok52 = ring.prior(rows, W52)
    mx20, mn20, ok20 = ring.prior(rows, W20)
    with np.errstate(invalid="ignore"):
        nh52, nl52 = ok52 & (h > mx52), ok52 & (lo < mn52)
        nh20, nl20 = ok20 & (h > mx20), ok20 & (lo < mn20)
    ring.write(date_iso, rows, h, lo, c)
    a50, v50 = ring.sma_above(rows, c, 50)
    a200, v200 = ring.sma_above(rows, c, 200)

    member = {u: np.zeros(len(syms), dtype=bool) for u in UNIVERSES}
    uct = cls.uct(date_iso)
    for i, s in enumerate(syms):
        for u in cls.classify(s, date_iso):
            member[u][i] = True
        if uct is not None and s in uct:
            member["uct"][i] = True
    out = {}
    for u, m in member.items():
        n = int(m.sum())
        if not n or (u == "uct" and uct is None):
            continue
        out[u] = [int((m & nh52).sum()), int((m & nl52).sum()), int((m & nh20).sum()),
                  int((m & nl20).sum()), n, int((m & ok52).sum()),
                  _pct(m & a50, m & v50), _pct(m & a200, m & v200)]
    return out


def _pct(hit: np.ndarray, valid: np.ndarray):
    v = int(valid.sum())
    return round(int(hit.sum()) / v * 100, 1) if v else None


# ── the sweep (background job) ──────────────────────────────────────────────

_job: dict = {"state": "none"}
_job_lock = threading.Lock()


def _settled_through() -> str:
    """The newest session whose daily bar has settled (ET close + 2h)."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from api.services import session_calendar as sc
    now = datetime.now(ZoneInfo("America/New_York"))
    d = now.date()
    for _ in range(10):
        if sc.is_trading_day(d):
            ct = sc.close_time(d)
            if ct is not None and now >= ct + _td(minutes=SETTLE_MINUTES_AFTER_CLOSE):
                return d.isoformat()
        d -= _td(days=1)
    return (now.date() - _td(days=10)).isoformat()


def _sessions_after(last: Optional[str], through: str) -> list:
    from api.services import session_calendar as sc
    d = _date.fromisoformat(last) + _td(days=1) if last else _date.fromisoformat(START)
    end = _date.fromisoformat(through)
    out = []
    while d <= end:
        if d.weekday() < 5 and (not sc.covers(d) or sc.is_trading_day(d)):
            out.append(d.isoformat())
        d += _td(days=1)
    return out


def _load_series() -> dict:
    try:
        with open(SERIES_PATH) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _write_series(series: dict, upload: bool) -> str:
    body = json.dumps(series, separators=(",", ":"), sort_keys=True).encode()
    tmp = SERIES_PATH + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(body)
    os.replace(tmp, SERIES_PATH)
    sha = hashlib.sha256(body).hexdigest()
    if upload:
        try:
            from api.services import data_sync
            data_sync.put_bytes(R2_KEY, gzip.compress(body), "application/gzip")
        except Exception as e:
            _log.warning("[nhnl] R2 upload failed: %s", e)
    _view.clear()
    return sha


def _restore_from_r2() -> bool:
    """A fresh volume (or a lost file) restores the series from R2 instead of re-sweeping."""
    if os.path.exists(SERIES_PATH):
        return True
    try:
        from api.services import data_sync
        raw = data_sync.get_bytes(R2_KEY)
        if not raw:
            return False
        body = gzip.decompress(raw)
        json.loads(body)
        with open(SERIES_PATH + ".tmp", "wb") as fh:
            fh.write(body)
        os.replace(SERIES_PATH + ".tmp", SERIES_PATH)
        return True
    except Exception:
        return False


def sweep(rebuild: bool = False, max_sessions: Optional[int] = None,
          progress: Optional[dict] = None) -> dict:
    """Extend (or rebuild) the series through the newest settled session. Resumable."""
    from api.services import massive
    from api.services import breadth_pit_frame as bpf
    t0 = time.time()
    series = {} if rebuild else _load_series()
    ring, meta = None, {}
    if not rebuild and os.path.exists(STATE_PATH):
        try:
            ring, meta = Ring.load(STATE_PATH)
        except Exception as e:
            _log.warning("[nhnl] state unreadable (%s) — rebuilding", e)
            ring, series = None, {}
    if ring is None:
        ring, series = Ring(), {}
    series.setdefault("version", VERSION)
    series.setdefault("basis", BASIS_TEXT)
    series.setdefault("fields", ["nh52", "nl52", "nh20", "nl20", "members", "valid52",
                                 "pct_above_50sma_check", "pct_above_200sma_check"])
    rows = series.setdefault("rows", {})
    last = ring.dates[-1] if ring.dates else None
    todo = _sessions_after(last, _settled_through())
    if max_sessions:
        todo = todo[:max_sessions]
    cls = Classifier(bpf.reference_map())
    done, failed = 0, []
    for i, d in enumerate(todo):
        if progress is not None:
            progress.update({"at": d, "done": done, "of": len(todo)})
        try:
            res = massive.get_grouped_daily_frame(d, adjusted=True, store=False)
        except Exception as e:
            failed.append((d, str(e)[:200]))
            break                      # never skip a session: the window would be wrong
        frame = res.get("rows") or {}
        if not frame:
            time.sleep(PACE_SECONDS)
            continue                   # a closure (provider answered empty)
        out = measure(ring, d, frame, cls)
        for u, v in out.items():
            rows.setdefault(u, {})[d] = v
        done += 1
        del frame, res
        if done % 250 == 0:
            ring.compact()
            ring.save(STATE_PATH, {"version": VERSION})
            _write_series(series, upload=False)
        time.sleep(PACE_SECONDS)
    ring.compact()
    ring.save(STATE_PATH, {"version": VERSION})
    series["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    series["through"] = ring.dates[-1] if ring.dates else None
    sha = _write_series(series, upload=True)
    return {"ok": not failed, "sessions": done, "pending": len(todo) - done,
            "failed": failed, "through": series["through"], "sha256": sha,
            "seconds": round(time.time() - t0, 1)}


def start_sweep(rebuild: bool = False, max_sessions: Optional[int] = None) -> dict:
    with _job_lock:
        if _job.get("state") == "running":
            return dict(_job)
        prog: dict = {}
        _job.clear()
        _job.update({"state": "running", "started_at": time.time(), "progress": prog})

    def run():
        try:
            r = sweep(rebuild=rebuild, max_sessions=max_sessions, progress=prog)
            _job.update({"state": "done", "result": r, "finished_at": time.time()})
        except Exception as e:
            _log.exception("[nhnl] sweep failed")
            _job.update({"state": "error", "error": f"{type(e).__name__}: {e}",
                         "finished_at": time.time()})

    threading.Thread(target=run, name="nhnl-intraday-sweep", daemon=True).start()
    return dict(_job)


def job() -> dict:
    return {k: v for k, v in _job.items()}


def scheduled_extend() -> None:
    """Nightly / morning: restore from R2 if needed, then extend through the settled session."""
    if basis() == "off":
        return
    _restore_from_r2()
    if not os.path.exists(STATE_PATH):
        return                         # no ring yet: the one-off sweep has not been run
    start_sweep()


# ── serving ─────────────────────────────────────────────────────────────────

_view: dict = {}


def _series_view() -> Optional[dict]:
    """{"sha", "rows"} for the installed series, memoised on file mtime; None when absent."""
    try:
        st = os.stat(SERIES_PATH)
    except OSError:
        if not _restore_from_r2():
            return None
        try:
            st = os.stat(SERIES_PATH)
        except OSError:
            return None
    key = (st.st_mtime_ns, st.st_size)
    if _view.get("key") == key:
        return _view["value"]
    with open(SERIES_PATH, "rb") as fh:
        body = fh.read()
    s = json.loads(body)
    v = {"sha": hashlib.sha256(body).hexdigest(), "rows": s.get("rows") or {},
         "through": s.get("through")}
    _view.clear()
    _view.update({"key": key, "value": v})
    return v


def active() -> bool:
    if basis() != "intraday":
        return False
    try:
        v = _series_view()
    except Exception:
        return False
    return bool(v and v["rows"])


def token() -> str:
    """'' unless the intraday series is being served; else its identity (cache keys / ETags)."""
    if not active():
        return ""
    return ":nhnl-" + _series_view()["sha"][:10]


def values(universe: str, date_iso: str) -> Optional[dict]:
    """{metric: value} for one universe/session under the intraday basis, or None."""
    if not active():
        return None
    r = (_series_view()["rows"].get(_uni(universe)) or {}).get(date_iso)
    return derive(r) if r else None


def derive(r) -> dict:
    nh, nl, nh20, nl20, n = r[0], r[1], r[2], r[3], r[4]
    return {"new_52w_highs": nh, "new_52w_lows": nl, "new_20d_highs": nh20,
            "new_20d_lows": nl20, "net_new_high_low": nh - nl,
            "hi_ratio": round(nh / n * 100, 2) if n else None,
            "lo_ratio": round(nl / n * 100, 2) if n else None}


def _uni(u) -> str:
    u = str(u or "uct").strip().lower()
    return "uct" if u in ("", "default", "uct") else u


def override_history(metric: str, universe: str, hist: dict, with_source: bool = False) -> dict:
    """`breadth_daily_ohlc.history`'s {date: {o,h,l,c}} with this series' value for every
    session it covers (a flat body: one count per session, no observed intraday range)."""
    if metric not in SERVED or not hist or not active():
        return hist
    rows = _series_view()["rows"].get(_uni(universe)) or {}
    if not rows:
        return hist
    out = dict(hist)
    for d in hist:
        r = rows.get(d)
        if r is None:
            continue
        v = derive(r).get(metric)
        if v is None:
            continue
        # a BODY (no o/h/l): the series has one count per session, no observed intraday range
        out[d] = {"o": None, "h": None, "l": None, "c": v}
        if with_source:
            out[d]["src"] = VERSION
    return out


def override_v2_rows(universe: str, date_iso: str, rows: dict) -> dict:
    """`breadth_authority.v2_rows`' {metric: (o, h, l, c, source)} under the intraday basis."""
    if not rows:
        return rows
    vals = values(universe, date_iso)
    if not vals:
        return rows
    out = dict(rows)
    for m, v in vals.items():
        if v is not None and (m in out or m in COUNTS):
            out[m] = (None, None, None, v, VERSION)
    return out


# ── live (today's developing row) ───────────────────────────────────────────

_live_ring: dict = {}


def _ring_for_live() -> Optional[Ring]:
    try:
        st = os.stat(STATE_PATH)
    except OSError:
        return None
    key = (st.st_mtime_ns, st.st_size)
    if _live_ring.get("key") != key:
        ring, _ = Ring.load(STATE_PATH)
        _live_ring.clear()
        _live_ring.update({"key": key, "ring": ring})
    return _live_ring["ring"]


def live_counts(universe: str, highs: dict, lows: dict, members, session_iso: str,
                lists: bool = False) -> Optional[dict]:
    """Today's intraday counts for `members` from the snapshot's running high/low, measured
    against the ring's prior windows — None unless the ring ends at the session BEFORE
    `session_iso` (a stale window would compare today against the wrong year).
    For a session the series already holds, the series' own value is returned."""
    if not active():
        return None
    settled = values(universe, session_iso)
    if settled is not None:
        return settled
    ring = _ring_for_live()
    if ring is None or not ring.dates or ring.dates[-1] >= session_iso:
        return None
    try:
        from api.services import session_calendar as sc
        d = _date.fromisoformat(session_iso) - _td(days=1)
        while not sc.is_trading_day(d):
            d -= _td(days=1)
        if ring.dates[-1] != d.isoformat():
            return None
    except Exception:
        return None
    syms = [canon(t) for t in members if highs.get(t) and lows.get(t)]
    raw = [t for t in members if highs.get(t) and lows.get(t)]
    if not syms:
        return None
    idx = np.asarray([ring.index.get(s, -1) for s in syms], dtype=np.int64)
    known = idx >= 0
    h = np.asarray([highs[t] for t in raw], dtype=np.float32)
    lo = np.asarray([lows[t] for t in raw], dtype=np.float32)
    nh52 = np.zeros(len(syms), dtype=bool)
    nl52, nh20, nl20 = nh52.copy(), nh52.copy(), nh52.copy()
    if known.any():
        rows = idx[known]
        mx52, mn52, ok52 = ring.prior(rows, W52)
        mx20, mn20, ok20 = ring.prior(rows, W20)
        with np.errstate(invalid="ignore"):
            nh52[known] = ok52 & (h[known] > mx52)
            nl52[known] = ok52 & (lo[known] < mn52)
            nh20[known] = ok20 & (h[known] > mx20)
            nl20[known] = ok20 & (lo[known] < mn20)
    n = len(syms)
    out = derive([int(nh52.sum()), int(nl52.sum()), int(nh20.sum()), int(nl20.sum()), n])
    if lists:
        out["_lists"] = {"new_52w_highs": [raw[i] for i in np.nonzero(nh52)[0]],
                         "new_52w_lows": [raw[i] for i in np.nonzero(nl52)[0]],
                         "new_20d_highs": [raw[i] for i in np.nonzero(nh20)[0]],
                         "new_20d_lows": [raw[i] for i in np.nonzero(nl20)[0]]}
    return out


def status() -> dict:
    v = None
    try:
        v = _series_view()
    except Exception:
        pass
    ring = None
    try:
        ring = _ring_for_live()
    except Exception:
        pass
    return {"basis": basis(), "active": active(), "version": VERSION,
            "series_sha": (v or {}).get("sha"), "through": (v or {}).get("through"),
            "universes": {u: len(r) for u, r in ((v or {}).get("rows") or {}).items()},
            "ring_through": ring.dates[-1] if ring and ring.dates else None,
            "ring_tickers": len(ring.tickers) if ring else None, "job": job()}


# ── population diagnostic ───────────────────────────────────────────────────

def diagnose_population(min_history: int = 1) -> dict:
    """For the ring's newest session: intraday AND closing new highs/lows per listing venue and
    security type — the evidence for which population a published diary (WSJ / Dow Jones,
    StockCharts) counts. Two window rules: `complete` (all 251 prior sessions present, our rule)
    and `listed` (at least `min_history` prior sessions — "high since listing" for young issues)."""
    from collections import defaultdict
    from api.services import breadth_pit_frame as bpf
    ring = _ring_for_live()
    if ring is None or ring.n < RING:
        return {"ok": False, "reason": "ring not full"}
    D = ring.dates[-1]
    s = (ring.n - 1) % RING
    prior = [c for c in range(RING) if c != s]
    nt = len(ring.tickers)
    H, L, C = ring.H[:nt], ring.L[:nt], ring.C[:nt]
    h, lo, c = H[:, s], L[:, s], C[:, s]
    ph, pl, pc = H[:, prior], L[:, prior], C[:, prior]
    with np.errstate(invalid="ignore"), _quiet():
        n_prior = (~np.isnan(ph)).sum(axis=1)
        mxh, mnl = np.nanmax(ph, axis=1), np.nanmin(pl, axis=1)
        mxc, mnc = np.nanmax(pc, axis=1), np.nanmin(pc, axis=1)
        traded = ~np.isnan(h) & ~np.isnan(lo)
        complete = traded & (n_prior == RING - 1)
        listed = traded & (n_prior >= min_history)
        nh_i, nl_i = h > mxh, lo < mnl
        nh_c, nl_c = c >= mxc, c <= mnc
    ref = {canon(k): v for k, v in bpf.reference_map().items()}
    agg = defaultdict(lambda: defaultdict(int))
    for i, t in enumerate(ring.tickers):
        if not traded[i]:
            continue
        rec = bpf.resolve(ref.get(t), D) or {}
        key = "%s|%s" % ((rec.get("primary_exchange") or "?").upper(), rec.get("type") or "?")
        a = agg[key]
        a["traded"] += 1
        for rule, m in (("complete", complete[i]), ("listed", listed[i])):
            if m:
                a[rule + "_n"] += 1
                a[rule + "_nh_intraday"] += int(bool(nh_i[i]))
                a[rule + "_nl_intraday"] += int(bool(nl_i[i]))
                a[rule + "_nh_close"] += int(bool(nh_c[i]))
                a[rule + "_nl_close"] += int(bool(nl_c[i]))
    return {"ok": True, "session": D, "by_venue_type": {k: dict(v) for k, v in sorted(agg.items())}}
