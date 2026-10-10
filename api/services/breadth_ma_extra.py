"""% of stocks above the 20-day and 150-day SIMPLE moving averages — history for US / NYSE / Nasdaq.

⭐⭐ WHY (2026-10-10, owner). Every other "% above MA" reading is a simple average and so are the
published ones it is compared with (StockCharts $NYA20R/$NAA20R/$NYA150R/$NAA150R, Barchart
$MMTW/$MMOF); ours carried a 20-day EMA and no 150-day. The live engines compute both now, but the
canonical US V2 / Exchange V1 artifacts (frozen, pinned) never stored them — so their history is
measured here, once, and kept current nightly, and served at read time beside the canonical rows.

⭐ THE SAME FRAME AND MEMBERSHIP AS THE INTRADAY NEW-HIGHS SERIES (`breadth_nhnl_intraday`): the
provider's split-adjusted grouped daily bars, a ticker counted on D when it traded on D, classified
by the reference map (CS/ADRC on the universe's venues). A 20- or 150-session simple average of the
close INCLUDING D, a name counted only with a complete window — the live engine's own rule.
⚠️ Split-adjusted, not dividend-adjusted (the canonical MA family is dividend-adjusted): over 20 and
150 sessions the difference is a fraction of a point, and live readings anchor to these values.

UCT's history comes from the close-reconstruction store instead (`sweep_history`, its own list).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import threading
import time
from typing import Optional

import numpy as np

from api.services import breadth_nhnl_intraday as nhi

_log = logging.getLogger("breadth_ma_extra")

VERSION = "ma-extra-v1"
METRICS = {"pct_above_20sma": (0, 20), "pct_above_150sma": (1, 150)}
UNIVERSES = ("us", "nyse", "nasdaq")

_DATA = os.environ.get("DATA_DIR", "/data")
SERIES_PATH = os.path.join(_DATA, "breadth_ma_extra_v1.json")
STATE_PATH = os.path.join(_DATA, "breadth_ma_extra_v1_state.npz")
R2_KEY = "breadth_ma_extra/v1.json.gz"


def measure(ring: "nhi.Ring", date_iso: str, frame: dict, cls) -> dict:
    """Advance the ring by one settled session and return {universe: [pct20, pct150, n20, n150]}."""
    syms, h, lo, c = [], [], [], []
    for t, r in frame.items():
        hh, ll, cc = r.get("h"), r.get("l"), r.get("c")
        if hh is None or ll is None or cc is None or not (r.get("v") or 0) > 0:
            continue
        syms.append(nhi.canon(t))
        h.append(hh)
        lo.append(ll)
        c.append(cc)
    rows = ring.rows_for(syms)
    c = np.asarray(c, dtype=np.float32)
    ring.write(date_iso, rows, np.asarray(h, dtype=np.float32), np.asarray(lo, dtype=np.float32), c)
    a20, v20 = ring.sma_above(rows, c, 20)
    a150, v150 = ring.sma_above(rows, c, 150)
    member = {u: np.zeros(len(syms), dtype=bool) for u in UNIVERSES}
    for i, s in enumerate(syms):
        for k in cls.classify(s, date_iso):
            if k in member:
                member[k][i] = True
    out = {}
    for u, m in member.items():
        if not m.any():
            continue
        out[u] = [nhi._pct(m & a20, m & v20), nhi._pct(m & a150, m & v150),
                  int((m & v20).sum()), int((m & v150).sum())]
    return out


_job: dict = {"state": "none"}
_job_lock = threading.Lock()


def _load_series() -> dict:
    try:
        with open(SERIES_PATH) as fh:
            return json.load(fh)
    except Exception:
        return {}


def _write_series(series: dict, upload: bool) -> str:
    body = json.dumps(series, separators=(",", ":"), sort_keys=True).encode()
    with open(SERIES_PATH + ".tmp", "wb") as fh:
        fh.write(body)
    os.replace(SERIES_PATH + ".tmp", SERIES_PATH)
    if upload:
        try:
            from api.services import data_sync
            data_sync.put_bytes(R2_KEY, gzip.compress(body), "application/gzip")
        except Exception as e:
            _log.warning("[ma_extra] R2 upload failed: %s", e)
    _view.clear()
    return hashlib.sha256(body).hexdigest()


def _restore_from_r2() -> bool:
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
    """Extend (or rebuild) through the newest settled session. Resumable (checkpoint every 250)."""
    from api.services import massive
    from api.services import breadth_pit_frame as bpf
    t0 = time.time()
    series = {} if rebuild else _load_series()
    ring = None
    if not rebuild and os.path.exists(STATE_PATH):
        try:
            ring, _ = nhi.Ring.load(STATE_PATH)
        except Exception:
            ring, series = None, {}
    if ring is None:
        ring, series = nhi.Ring(), {}
    series.setdefault("version", VERSION)
    series.setdefault("fields", ["pct_above_20sma", "pct_above_150sma", "valid20", "valid150"])
    rows = series.setdefault("rows", {})
    last = ring.dates[-1] if ring.dates else None
    todo = nhi._sessions_after(last, nhi._settled_through())
    if max_sessions:
        todo = todo[:max_sessions]
    cls = nhi.Classifier(bpf.reference_map())
    done, failed = 0, []
    for d in todo:
        if progress is not None:
            progress.update({"at": d, "done": done, "of": len(todo)})
        try:
            res = massive.get_grouped_daily_frame(d, adjusted=True, store=False)
        except Exception as e:
            failed.append((d, str(e)[:200]))
            break
        frame = res.get("rows") or {}
        if not frame:
            time.sleep(nhi.PACE_SECONDS)
            continue
        for u, v in measure(ring, d, frame, cls).items():
            rows.setdefault(u, {})[d] = v
        done += 1
        del frame, res
        if done % 250 == 0:
            ring.compact()
            ring.save(STATE_PATH, {"version": VERSION})
            _write_series(series, upload=False)
        time.sleep(nhi.PACE_SECONDS)
    ring.compact()
    ring.save(STATE_PATH, {"version": VERSION})
    series["through"] = ring.dates[-1] if ring.dates else None
    series["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    sha = _write_series(series, upload=True)
    return {"ok": not failed, "sessions": done, "pending": len(todo) - done, "failed": failed,
            "through": series["through"], "sha256": sha, "seconds": round(time.time() - t0, 1)}


def start_sweep(rebuild: bool = False, max_sessions: Optional[int] = None) -> dict:
    with _job_lock:
        if _job.get("state") == "running":
            return dict(_job)
        prog: dict = {}
        _job.clear()
        _job.update({"state": "running", "started_at": time.time(), "progress": prog})

    def run():
        try:
            _job.update({"state": "done", "result": sweep(rebuild, max_sessions, prog),
                         "finished_at": time.time()})
        except Exception as e:
            _log.exception("[ma_extra] sweep failed")
            _job.update({"state": "error", "error": f"{type(e).__name__}: {e}"})

    threading.Thread(target=run, name="ma-extra-sweep", daemon=True).start()
    return dict(_job)


def job() -> dict:
    return dict(_job)


def scheduled_extend() -> None:
    _restore_from_r2()
    if os.path.exists(STATE_PATH):
        start_sweep()
    extend_uct()


def extend_uct(lookback_sessions: int = 7) -> dict:
    """UCT's 20/150-day SMA rows for the newest sessions, written to the UCT store by the
    close-reconstruction sweep in MISSING-ONLY mode (it never re-states an existing value).
    A no-op when the store already holds the newest settled session."""
    try:
        from api.services import breadth_daily_ohlc as bdo
        from api.services import breadth_history_recon as recon
        last = nhi._settled_through()
        have = bdo._history_stored("pct_above_20sma", limit=5) or {}
        if have and max(have) >= last:
            return {"ok": True, "current": max(have)}
        sessions = nhi._sessions_after(None, last)[-lookback_sessions:]
        threading.Thread(target=recon.run_sweep_async, args=(sessions[0], last, 0, True),
                         name="ma-extra-uct", daemon=True).start()
        return {"ok": True, "started": [sessions[0], last]}
    except Exception as e:
        _log.warning("[ma_extra] UCT extend failed: %s", e)
        return {"ok": False, "error": str(e)}


# ── serving ─────────────────────────────────────────────────────────────────
_view: dict = {}


def _series_view() -> Optional[dict]:
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
    if _view.get("key") != key:
        with open(SERIES_PATH, "rb") as fh:
            body = fh.read()
        s = json.loads(body)
        _view.clear()
        _view.update(key=key, value={"rows": s.get("rows") or {}, "through": s.get("through"),
                                     "sha": hashlib.sha256(body).hexdigest()})
    return _view["value"]


def token() -> str:
    try:
        v = _series_view()
    except Exception:
        return ""
    return (":ma-" + v["sha"][:10]) if v and v["rows"] else ""


def override_history(metric: str, universe: str, hist: dict, with_source: bool = False) -> dict:
    """`breadth_daily_ohlc.history` rows for a metric the canonical authorities never stored: this
    series' value on every session it holds (a body — one close), the stored rows kept as is."""
    if metric not in METRICS:
        return hist
    u = str(universe or "").strip().lower()
    if u not in UNIVERSES:
        return hist
    try:
        v = _series_view()
    except Exception:
        return hist
    rows = (v or {}).get("rows", {}).get(u) or {}
    if not rows:
        return hist
    idx = METRICS[metric][0]
    out = dict(hist or {})
    for d, r in rows.items():
        if d in out or r[idx] is None:
            continue
        out[d] = {"o": None, "h": None, "l": None, "c": r[idx]}
        if with_source:
            out[d]["src"] = VERSION
    return out


def status() -> dict:
    v = None
    try:
        v = _series_view()
    except Exception:
        pass
    return {"version": VERSION, "through": (v or {}).get("through"),
            "universes": {u: len(r) for u, r in ((v or {}).get("rows") or {}).items()}, "job": job()}
