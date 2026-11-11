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

import http.client
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


CONNECT_TIMEOUT_S = 3.0


def _ipv4_connect(host: str, port: int, connect_timeout: float, read_timeout: float) -> socket.socket:
    """TCP connect over IPv4 only, with its OWN short connect timeout.

    ⛔ urllib has no happy-eyeballs: on a host with a broken IPv6 path every connect first waits
    out the IPv6 attempt (measured ~20 s on a dev PC), which a browser never sees — that would be
    reported as member latency. IPv4-only + a 3 s connect bound keeps the measurement honest."""
    last = None
    for fam, typ, proto, _cn, addr in socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM):
        sock = socket.socket(fam, typ, proto)
        try:
            sock.settimeout(connect_timeout)
            sock.connect(addr)
            sock.settimeout(read_timeout)
            return sock
        except OSError as e:
            last = e
            sock.close()
    raise last or OSError("no IPv4 address")


class _V4HTTPSConnection(http.client.HTTPSConnection):
    connect_timeout = CONNECT_TIMEOUT_S

    def connect(self):
        sock = _ipv4_connect(self.host, self.port, self.connect_timeout, self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _V4HTTPConnection(http.client.HTTPConnection):
    connect_timeout = CONNECT_TIMEOUT_S

    def connect(self):
        self.sock = _ipv4_connect(self.host, self.port, self.connect_timeout, self.timeout)


class _V4HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_V4HTTPSConnection, req, context=self._context)


class _V4HTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_V4HTTPConnection, req)


def build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_V4HTTPHandler, _V4HTTPSHandler)


class Http:
    """Paced client for the public edge.

    ⛔ ``auth`` defaults OFF: REST ``/api/bars`` is probed exactly as a member's browser reaches
    the edge (no service bearer), so the monitor measures member-path behaviour. Only the SSE
    sample (web pod, ``require_bars_access``) asks for the bearer, per call (``headers(auth=True)``)."""

    def __init__(self, base: str, rps: float = 3.0, timeout: float = 20.0, auth: bool = False,
                 opener: Optional[urllib.request.OpenerDirector] = None):
        self.base = base.rstrip("/")
        self.min_iv = 1.0 / max(rps, 0.1)
        self.timeout = timeout
        self.auth = auth
        self.opener = opener or build_opener()
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

    def headers(self, accept: str = "application/json", auth: Optional[bool] = None) -> dict:
        h = {"User-Agent": UA, "Accept": accept, "Cache-Control": "no-cache"}
        if self.auth if auth is None else auth:
            h.update(service_headers())
        return h

    def get_json(self, path: str, max_retries: int = 2, deadline: Optional[float] = None) -> dict:
        """{status, ms, headers{lower}, body|None, retries, error, clean}.

        Retries 429/502/503/504 and transport errors honouring Retry-After (<= 10 s), never past
        ``deadline`` (a ``time.monotonic()`` instant). ``ms`` is the FINAL attempt's latency and
        ``clean`` is True only for a 200 answered on the first attempt with no transport error —
        the ONLY answers whose latency may be counted (a timeout-then-retry is not a latency)."""
        url = self.base + path
        retries = 0
        while True:
            self._pace()
            t0 = time.perf_counter()
            status, hdrs, raw, err = None, {}, b"", None
            try:
                req = urllib.request.Request(url, headers=self.headers())
                with self.opener.open(req, timeout=self.timeout) as r:
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
                if deadline is None or time.monotonic() + delay + 1.0 < deadline:
                    retries += 1
                    time.sleep(delay)
                    continue
            return {"status": status, "ms": ms, "headers": hdrs, "body": body, "retries": retries,
                    "error": err, "clean": status == 200 and err is None and retries == 0}


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
        resp = http.opener.open(urllib.request.Request(url, headers=http.headers("text/event-stream", auth=True)),
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
