"""Stdlib HTTP + SSE client for the chart-data monitor. Talks to the PUBLIC edge.

⭐ WHY THE PUBLIC URL AND NOT AN IN-PROCESS SERVE. The monitor runs on the worker, whose bars.db
is the snapshot source — NOT the store members are served from (bars-api, behind the
Cloudflare edge router, with the web pod as edge fallback). Probing ``https://<site>/api/bars``
exercises exactly the member path: edge routing, tier vs web-fallback, deadlines, the
tail_status contract. An in-process call here would test a different database.

AUTH. ``/api/bars`` through the edge needs no credential today (bars-api data routes are
deliberately ungated — ``bars_api_main.py``). ``/api/stream/bars`` lives on the web pod behind
``require_bars_access``, which admits the existing service bearer (``bars_service_headers`` —
``PUSH_SECRET``). No member session is used or needed.

⛔ PRIVACY: nothing in this module logs a response body.
"""
from __future__ import annotations

import json
import queue
import socket
import threading
import time
import urllib.error
import urllib.request
from typing import Optional

#: Cloudflare 1010-blocks non-browser user agents on the public domain (history_prewarm's
#: finding), so a browser UA with an identifying suffix.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36 uct-chart-monitor/1")


def service_headers() -> dict:
    try:
        from api.bars_auth import bars_service_headers
        return bars_service_headers()
    except Exception:  # noqa: BLE001
        return {}


class Http:
    def __init__(self, base: str, rps: float = 3.0, timeout: float = 20.0, auth: bool = True):
        self.base = base.rstrip("/")
        self.min_iv = 1.0 / max(rps, 0.1)
        self.timeout = timeout
        self.auth = auth
        self._last = 0.0
        self._lock = threading.Lock()
        self.requests = 0

    def _pace(self) -> None:
        with self._lock:
            dt = self._last + self.min_iv - time.monotonic()
            if dt > 0:
                time.sleep(dt)
            self._last = time.monotonic()
            self.requests += 1

    def headers(self, accept: str = "application/json") -> dict:
        h = {"User-Agent": UA, "Accept": accept, "Cache-Control": "no-cache"}
        if self.auth:
            h.update(service_headers())
        return h

    def get_json(self, path: str, max_retries: int = 2) -> dict:
        """{status, ms, headers{lower}, body|None, retries, error}. Retries 429/502/503/504 and
        transport errors honouring Retry-After (<= 10 s); ``ms`` is the FIRST attempt's latency."""
        url = self.base + path
        retries, first_ms = 0, None
        while True:
            self._pace()
            t0 = time.perf_counter()
            status, hdrs, raw, err = None, {}, b"", None
            try:
                req = urllib.request.Request(url, headers=self.headers())
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    status = r.status
                    hdrs = {k.lower(): v for k, v in r.headers.items()}
                    raw = r.read()
            except urllib.error.HTTPError as e:
                status = e.code
                hdrs = {k.lower(): v for k, v in (e.headers or {}).items()}
                try:
                    raw = e.read()
                except Exception:
                    raw = b""
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as e:
                err = type(e).__name__
            ms = (time.perf_counter() - t0) * 1000
            first_ms = ms if first_ms is None else first_ms
            body = None
            if raw:
                try:
                    body = json.loads(raw)
                except Exception:
                    if status == 200:
                        err = "non-json-body"
            if (err is not None or status in (429, 502, 503, 504)) and retries < max_retries:
                try:
                    delay = min(float(hdrs.get("retry-after") or 1.5 * (retries + 1)), 10.0)
                except ValueError:
                    delay = 2.0
                retries += 1
                time.sleep(delay)
                continue
            return {"status": status, "ms": first_ms, "headers": hdrs, "body": body,
                    "retries": retries, "error": err}


def _norm_t(t) -> int:
    t = int(t)
    return t // 1000 if t > 10_000_000_000 else t


def sample_stream(http: Http, pairs: list[tuple[str, str]], seconds: float, settle: float,
                  fetch_row, *, session: str = "rth") -> dict:
    """Hold one v=2 SSE connection for ``seconds``; for every bucket that CLOSES while watching
    (a ``final`` frame or a newer ``t``), wait ``settle`` s and compare its last stream bar with the
    REST row (``fetch_row(sym, tf, t) -> row | None | 'error'``).

    Returns {status, error, frames, finals, comparisons[...], hl_regressions} — counts and relative
    diffs only."""
    qs = ",".join(f"{s}:{t}" for s, t in pairs)
    url = f"{http.base}/api/stream/bars?bars={qs}&v=2" + (f"&session={session}" if session != "rth" else "")
    out = {"status": None, "error": None, "frames": 0, "finals": 0, "comparisons": [],
           "hl_regressions": 0, "max_gap_s": 0.0}
    http._pace()
    try:
        resp = urllib.request.urlopen(urllib.request.Request(url, headers=http.headers("text/event-stream")),
                                      timeout=30)
        out["status"] = resp.status
    except urllib.error.HTTPError as e:
        out["status"] = e.code
        try:
            body = json.loads(e.read() or b"{}")
            out["error"] = str(body.get("error") or body.get("detail") or "")[:80]
        except Exception:
            out["error"] = ""
        return out
    except Exception as e:  # noqa: BLE001
        out["error"] = type(e).__name__
        return out

    q: "queue.Queue" = queue.Queue()
    stop = threading.Event()

    def reader():
        ev, data = None, []
        try:
            while not stop.is_set():
                line = resp.readline()
                if not line:
                    q.put(("eof", None))
                    return
                line = line.decode("utf-8", "replace").rstrip("\r\n")
                if line == "":
                    if data:
                        q.put((ev or "message", "\n".join(data)))
                    ev, data = None, []
                elif line.startswith("event:"):
                    ev = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].lstrip())
        except Exception as e:  # noqa: BLE001
            q.put(("error", type(e).__name__))

    threading.Thread(target=reader, daemon=True, name="chart-monitor-sse").start()
    buckets: dict = {}            # (sym, tf, t) -> {"bar", "final", "maxh", "minl", "scheduled"}
    newest: dict = {}             # (sym, tf) -> newest t
    pending: list = []            # (due, key)
    end = time.time() + seconds
    last_frame = time.time()

    def schedule(key):
        b = buckets.get(key)
        if b is not None and not b["scheduled"]:
            b["scheduled"] = True
            pending.append((time.time() + settle, key))

    try:
        while time.time() < end or (pending and time.time() < end + settle + 15):
            try:
                ev, data = q.get(timeout=0.5)
            except queue.Empty:
                ev = None
            now = time.time()
            if ev is not None:
                out["max_gap_s"] = max(out["max_gap_s"], round(now - last_frame, 1))
                last_frame = now
                if ev in ("eof", "error"):
                    out["error"] = f"{ev}:{data}"
                    break
                if ev == "bar" and now < end:
                    try:
                        m = json.loads(data)
                        sym, tf, b = str(m["sym"]).upper(), str(m["tf"]), m["bar"]
                        t = _norm_t(b["t"])
                        bar = {k: float(b[k]) for k in ("o", "h", "l", "c")}
                        bar["v"] = float(b.get("v") or 0)
                        fin = bool(b.get("final"))
                    except Exception:
                        continue
                    out["frames"] += 1
                    pk, key = (sym, tf), (sym, tf, t)
                    if pk in newest and t > newest[pk]:
                        schedule((sym, tf, newest[pk]))
                    newest[pk] = max(newest.get(pk, t), t)
                    s = buckets.setdefault(key, {"bar": bar, "final": False, "maxh": bar["h"],
                                                 "minl": bar["l"], "scheduled": False})
                    if not fin and not s["final"]:
                        if bar["h"] < s["maxh"] * (1 - 1e-9) or bar["l"] > s["minl"] * (1 + 1e-9):
                            out["hl_regressions"] += 1
                        s["maxh"], s["minl"] = max(s["maxh"], bar["h"]), min(s["minl"], bar["l"])
                    if fin:
                        out["finals"] += 1
                        s["final"] = True
                    s["bar"] = bar
                    if fin:
                        schedule(key)
            due = [p for p in pending if p[0] <= now]
            pending[:] = [p for p in pending if p[0] > now]
            for _, key in due:
                row = fetch_row(*key)
                if row == "error":
                    continue
                from api.services.chart_monitor.checks import compare_stream_rest
                rec = compare_stream_rest(buckets[key]["bar"], row)
                rec.update({"sym": key[0], "tf": key[1], "had_final": buckets[key]["final"]})
                out["comparisons"].append(rec)
    finally:
        stop.set()
        try:
            resp.close()
        except Exception:
            pass
    return out
