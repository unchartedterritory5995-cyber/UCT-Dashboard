"""Browser smoke for Import a tweet: the whole flow on a local backend, headless Chromium.

    python tools/tweet_import_smoke.py

Runs against a fresh sandbox under the session scratchpad (never C:\\data, never /data), a local
stub for the X lookup vendor, and its own Playwright context. It starts its own backend on a free
port, its own stub, and stops only those.

Prints PASS / FAIL / INCONCLUSIVE for each of the 12 checks, two controls that prove a check can
fail, and a totals line. Exit 0 only when every check passed and both controls held.

SCAFFOLDING, in this file and nowhere in the product:
  * `--serve` replaces `hotlink_fetch.download`, so a seeded pbs.twimg.com image is copied from
    local bytes instead of the real CDN; turns off `bars_seeder.start_background_seeder`, which
    would write real bars over the seeded ones; and wraps `tweet_price._fetch_bars` and
    `bars.serve_bars` with tracers that call the real functions and record what they returned.
  * A network guard refuses every non-loopback connection from the server, through both Python
    sockets and curl_cffi (libcurl, which yfinance uses and Python's `socket` cannot see).
  * `/api/snapshot/*` is answered at the browser for the "Now" half of the price line, because
    that route reads a live vendor this sandbox cannot reach. The card's "when posted" half is the
    real server path over seeded bars.
"""
from __future__ import annotations

import argparse
import importlib
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get(
    "TWEET_SMOKE_DIR",
    r"C:\Users\Patrick\AppData\Local\Temp\claude\6c61ec7db4c79b74"
    r"\e8531f12-2b96-4c3b-aa6e-6e29d36c0135\scratchpad\tweet-smoke"))
SHARED_ROOTS = ("c:\\data", "/data")

EMAIL = "tweet-smoke@local.dev"
PASSWORD = "LocalSmoke2026!"
SYMBOL = "NVDA"
NOTE_TITLE = f"{SYMBOL}: what people are saying"
ET = ZoneInfo("America/New_York")

NOT_A_LINK = "That doesn't look like a link to a post on X."
NOT_FOUND = "That post could not be found. It may be deleted or private."
POST_GONE = "This post is no longer on X."
INTRO_SEL = '[role="dialog"][aria-label="Welcome"]'
FORK_WORDS = ("conflicted copy", "could not safely replace", "Kept as a separate copy")

ID_BASE = 1990000000000000000
P1, P2, P3, P4, P5, P6, P7, P8 = (str(ID_BASE + n) for n in range(1, 9))
LINK_OK = str(ID_BASE + 201)
LINK_GONE = str(ID_BASE + 202)
IMG_HOST = "pbs.twimg.com"
SMOKE_IMG = "https://pbs.twimg.com/media/SmokeImgA.jpg"
SMOKE_AVATAR = "https://pbs.twimg.com/profile_images/1990/harbor_normal.jpg"


# ── fixtures ─────────────────────────────────────────────────────────────────────────────────

def _friday_before(today: date) -> date:
    d = today - timedelta(days=1)
    while d.weekday() != 4:
        d -= timedelta(days=1)
    return d


def _et(d: date, hour: int, minute: int, second: int = 0) -> int:
    return int(datetime(d.year, d.month, d.day, hour, minute, second, tzinfo=ET).timestamp())


def _tweet(tweet_id: str, handle: str, name: str, text: str, ts: int, raw: str = "{}") -> dict:
    return {"id": tweet_id, "author_handle": handle, "author_name": name, "text": text, "created_at": ts,
            "url": f"https://x.com/{handle}/status/{tweet_id}", "raw_json": raw}


def fixtures(now: float | None = None) -> dict:
    """Invented accounts and posts. Everything is relative to the last Friday, so it stays inside
    the 168 hour window on any day."""
    now = int(now or time.time())
    today = datetime.fromtimestamp(now, ET).date()
    fri = _friday_before(today)
    thu = fri - timedelta(days=1)
    with_image = json.dumps({"media": SMOKE_IMG, "avatar": SMOKE_AVATAR})
    posts = [
        (_tweet(P1, "tape_parrot", "Tape Parrot", "$NVDA supplier checks point to another strong quarter, per channel notes.",
                _et(fri, 14, 2, 30), with_image), ["NVDA"], "news"),
        (_tweet(P2, "marlin_desk", "Marlin Desk", "$NVDA held the 21 EMA again. Adding on a reclaim of the high.",
                _et(fri, 15, 17), "{}"), ["NVDA"], "commentary"),
        (_tweet(P3, "quiet_fox", "Quiet Fox", "Weekend note: $NVDA and $AMD both set up for a Monday gap. Not chasing.",
                now - 5 * 3600, "{}"), ["NVDA", "AMD"], "commentary"),
        # Thursday 12:04 ET, and intraday bars are seeded only for Friday: both direct bars.db
        # reads miss, so `price_at_post` goes through `_fetch_bars` -> the real `serve_bars`.
        (_tweet(P4, "north_ledger", "North Ledger", "$NVDA midday pullback to the rising 10 is the cleanest entry this month.",
                _et(thu, 12, 4, 30), "{}"), ["NVDA"], "commentary"),
        (_tweet(P5, "tape_parrot", "Tape Parrot", "$AMD raises its data center outlook for the year.",
                now - 45 * 60, "{}"), ["AMD"], "news"),
        (_tweet(P6, "marlin_desk", "Marlin Desk", "$NVDA tight flag on the 65 minute, watching the opening range.",
                _et(fri, 13, 40), "{}"), ["NVDA"], "commentary"),
        (_tweet(P7, "quiet_fox", "Quiet Fox", "Sizing down $NVDA ahead of the print, still long the rest.",
                _et(fri, 11, 20), "{}"), ["NVDA"], "commentary"),
        (_tweet(P8, "north_ledger", "North Ledger", "$NVDA relative strength line at a new high against the semis.",
                _et(fri, 10, 45), "{}"), ["NVDA"], "commentary"),
    ]
    daily = _daily_series(fri)
    intraday = _intraday_series(fri)
    return {"posts": posts, "daily": daily, "intraday": intraday, "fri": fri, "thu": thu,
            "p1_price": _expected_posted(intraday, _et(fri, 14, 2, 30)),
            "p4_close": next(b["c"] for b in daily if b["t"] == (thu - timedelta(days=1)).isoformat())}


def _daily_series(fri: date) -> list[dict]:
    days = []
    d = fri
    while len(days) < 90:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    bars = []
    for i, day in enumerate(days):
        close = round(140.0 + i * 0.5, 2)
        bars.append({"t": day.isoformat(), "o": round(close - 0.3, 2), "h": round(close + 1, 2),
                     "l": round(close - 1, 2), "c": close, "v": 40_000_000 + i})
    return bars


def _intraday_series(fri: date) -> list[dict]:
    open_ts = _et(fri, 9, 30)
    bars = []
    for i in range(78):
        close = round(180.0 + i * 0.1, 2)
        bars.append({"t": open_ts + i * 300, "o": round(close - 0.05, 2), "h": round(close + 0.2, 2),
                     "l": round(close - 0.2, 2), "c": close, "v": 100_000 + i})
    return bars


def _expected_posted(bars: list[dict], posted: int) -> float:
    return max((b for b in bars if b["t"] <= posted - 300), key=lambda b: b["t"])["c"]


def seed() -> None:
    from api.services import bars_sqlite, tweet_store

    fx = fixtures(float(os.environ["SMOKE_T0"]))
    tweet_store._init_db()
    for tweet, tickers, kind in fx["posts"]:
        handle = tweet["author_handle"]
        tweet_store.add_account(handle, display_name=tweet["author_name"], notes="smoke")
        tweet_store.set_account_content_kind(handle, kind)
        tweet_store.upsert_tweet(tweet, tickers)
    bars_sqlite.init_db()
    for sym in ("NVDA", "AMD"):
        written = bars_sqlite.put_bars(sym, "D", fx["daily"], date_tf=True)
        print(f"[seed] {sym} D bars written: {written}", flush=True)
    written = bars_sqlite.put_bars("NVDA", "5", fx["intraday"])
    print(f"[seed] NVDA 5m bars written: {written}", flush=True)


# ── the sandbox and its guards ───────────────────────────────────────────────────────────────

def _resolves_shared(value: str) -> bool:
    low = value.lower().replace("/", "\\")
    return any(low == s.replace("/", "\\") or low.startswith(s.replace("/", "\\") + "\\") for s in SHARED_ROOTS)


def assert_sandboxed(env: dict) -> None:
    """Fail closed before anything starts."""
    data_dir = env.get("DATA_DIR") or ""
    if not data_dir or _resolves_shared(data_dir):
        raise SystemExit(f"REFUSING TO START: DATA_DIR resolves to {data_dir!r}")
    resolved = Path(data_dir).resolve()
    if SCRATCH.resolve() not in resolved.parents:
        raise SystemExit(f"REFUSING TO START: DATA_DIR {resolved} is outside the scratchpad {SCRATCH}")
    bad = [f"{k}={v}" for k, v in env.items() if isinstance(v, str) and len(v) > 2 and _resolves_shared(v)]
    if bad:
        raise SystemExit("REFUSING TO START: these resolve into the shared root: " + "; ".join(sorted(bad)[:20]))
    if env.get("ALLOW_LOCAL_VENDOR_SOCKETS"):
        raise SystemExit("REFUSING TO START: ALLOW_LOCAL_VENDOR_SOCKETS is set")


def _loopback(host) -> bool:
    return str(host) in ("127.0.0.1", "::1", "localhost", "0.0.0.0", "")


def install_network_guard() -> None:
    """No socket from this process may leave the machine. Every refused attempt is logged."""
    log_path = os.environ["SMOKE_DENIED_LOG"]
    lock = threading.Lock()

    def denied(host, port) -> None:
        with lock, open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"host": str(host), "port": port}) + "\n")

    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def connect(self, address):
        host = address[0] if isinstance(address, tuple) else address
        if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(host):
            denied(host, address[1] if isinstance(address, tuple) else None)
            raise ConnectionRefusedError(f"smoke network guard: {host} is not loopback")
        return real_connect(self, address)

    def connect_ex(self, address):
        host = address[0] if isinstance(address, tuple) else address
        if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(host):
            denied(host, address[1] if isinstance(address, tuple) else None)
            return 111
        return real_connect_ex(self, address)

    def getaddrinfo(host, *a, **k):
        if host is not None and not _loopback(host):
            denied(host, a[0] if a else None)
            raise socket.gaierror(f"smoke network guard: {host} is not loopback")
        return real_getaddrinfo(host, *a, **k)

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = getaddrinfo

    # curl_cffi is libcurl: its sockets never pass through Python's `socket`, so the patches above
    # cannot see it. yfinance fetches through it, and a run without this reached Yahoo.
    from curl_cffi.requests import session as curl_session

    def refused(url):
        denied(urlsplit(str(url)).hostname, "curl_cffi")
        return ConnectionError(f"smoke network guard: curl_cffi may not reach {url}")

    def curl_request(self, method, url, *a, **k):
        raise refused(url)

    async def curl_async_request(self, method, url, *a, **k):
        raise refused(url)

    curl_session.Session.request = curl_request
    curl_session.AsyncSession.request = curl_async_request


def guard_selftest() -> dict:
    """Both halves of the network guard have to be able to fire, or its silence means nothing."""
    out = {}
    try:
        socket.create_connection(("example.com", 80), timeout=2).close()
        out["socket"] = "ESCAPED"
    except OSError as e:
        out["socket"] = "refused" if "smoke network guard" in str(e) else f"OTHER {type(e).__name__}: {e}"
    try:
        from curl_cffi import requests as curl_requests
        curl_requests.get("https://example.com", timeout=3)
        out["curl_cffi"] = "ESCAPED"
    except Exception as e:  # noqa: BLE001
        out["curl_cffi"] = "refused" if "smoke network guard" in str(e) else f"OTHER {type(e).__name__}: {e}"
    return out


def _prepare_process() -> None:
    """The sandbox helper's settings, in this process, before any product module loads."""
    sys.path.insert(0, str(ROOT))
    sandbox = importlib.import_module("tools.local_backend_sandbox")   # imports conftest: the tripwire
    # conftest forces a fresh temp auth store each import; put back the run's own, before any
    # api.* import reads it, so a restart still has the account.
    os.environ["AUTH_DB_PATH"] = os.environ["SMOKE_AUTH_DB"]
    os.environ.update(sandbox.OFF)
    os.environ.update(sandbox.SANDBOX_ONLY)
    os.environ["ADMIN_EMAILS"] = EMAIL
    sandbox._verify_sandbox()
    assert_sandboxed(dict(os.environ))
    install_network_guard()
    sandbox._verify_no_remote_sync()


def serve(port: int) -> int:
    _prepare_process()
    print(f"[serve] DATA_DIR={os.environ['DATA_DIR']} AUTH_DB_PATH={os.environ['AUTH_DB_PATH']}", flush=True)
    Path(os.environ["SMOKE_GUARD_RESULT"]).write_text(json.dumps(guard_selftest()), encoding="utf-8")

    import api.main  # noqa: F401
    from api.routers import bars as bars_router
    from api.services import bars_seeder
    from api.services.journal_two import hotlink_fetch, tweet_price

    # `USE_REMOTE_BARS=0` (the sandbox helper's setting) is what starts this seeder, and it would
    # write real daily bars over the seeded ones.
    bars_seeder.start_background_seeder = lambda: None

    def seed_when_up() -> None:
        """After startup, because a fresh DATA_DIR runs the one-shot intraday heals at boot and
        they delete recent 5m rows."""
        mark = Path(os.environ["SMOKE_SEED_MARK"])
        try:
            deadline = time.time() + 240
            while time.time() < deadline:
                if http_status(f"http://127.0.0.1:{port}/api/health") == 200:
                    break
                time.sleep(1)
            seed()
            mark.write_text("ok", encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            mark.write_text(f"error {type(e).__name__}: {e}", encoding="utf-8")
            raise

    threading.Thread(target=seed_when_up, daemon=True).start()

    png = _png_bytes()

    async def local_download(url, *a, **k):
        if urlsplit(url).hostname != IMG_HOST:
            raise ValueError(f"smoke: refused image host {url}")
        return png, "image/png"

    hotlink_fetch.download = local_download

    real_fetch = tweet_price._fetch_bars
    real_serve = bars_router.serve_bars
    trace_path = os.environ["SMOKE_FETCH_TRACE"]
    last_status = threading.local()

    def traced_serve(ticker, tf, bars=200, *a, **k):
        resp = real_serve(ticker, tf, bars, *a, **k)
        last_status.value = getattr(resp, "status_code", None)
        return resp

    bars_router.serve_bars = traced_serve

    def traced(symbol, tf, count):
        last_status.value = None
        rows = real_fetch(symbol, tf, count)
        with open(trace_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"symbol": symbol, "tf": tf, "count": count, "serve_status": last_status.value,
                                "rows": len(rows), "first": rows[0][0] if rows else None,
                                "last": rows[-1][0] if rows else None}) + "\n")
        return rows

    tweet_price._fetch_bars = traced

    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=port, log_level="warning")
    return 0


def removal() -> int:
    """The two nightly jobs, once, against this run's data."""
    _prepare_process()
    from api.services.auth_db import get_connection
    from api.services.journal_two import tweet_capture_sync as sync

    sweep = sync.run_sweep()
    marked = sync._stamp(sync._now() - timedelta(minutes=11))
    conn = get_connection()
    try:
        moved = conn.execute("UPDATE j2_note_tweet_captures SET gone_first_missed_at = ? "
                             "WHERE gone_first_missed_at IS NOT NULL", (marked,)).rowcount
        conn.commit()
    finally:
        conn.close()
    confirm = sync.run_confirm()
    print("REMOVAL" + json.dumps({"sweep": sweep, "backdated_rows": moved, "confirm": confirm}), flush=True)
    return 0


def _png_bytes() -> bytes:
    import io

    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (640, 360), (40, 80, 120)).save(buf, format="PNG")
    return buf.getvalue()


# ── the vendor stub ──────────────────────────────────────────────────────────────────────────

class StubState:
    def __init__(self):
        self.known: dict[str, dict] = {}
        self.gone: set[str] = set()
        self.calls: list[list[str]] = []


def stub_post(tweet: dict) -> dict:
    ts = time.gmtime(tweet["created_at"])
    return {"id": tweet["id"], "text": tweet["text"], "url": tweet["url"],
            "createdAt": time.strftime("%a %b %d %H:%M:%S +0000 %Y", ts),
            "author": {"userName": tweet["author_handle"], "name": tweet["author_name"],
                       "profilePicture": SMOKE_AVATAR}}


def start_stub(state: StubState) -> tuple[ThreadingHTTPServer, int]:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            url = urlsplit(self.path)
            if url.path != "/twitter/tweets":
                self.send_response(404)
                self.end_headers()
                return
            ids = (parse_qs(url.query).get("tweet_ids") or [""])[0].split(",")
            state.calls.append(ids)
            tweets = [state.known[i] for i in ids if i in state.known and i not in state.gone]
            body = json.dumps({"status": "success", "tweets": tweets}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


# ── reporting ────────────────────────────────────────────────────────────────────────────────

CHECKS = {
    1: "Ticker page shows Import a tweet beside Save from a transcript",
    2: "Sheet shows seeded posts; scope, Headlines and search filter",
    3: "Tick two, import to a new note; cursor in first card's My take",
    4: "Card anatomy, real price, _fetch_bars path, /save wire has ids only",
    5: "My take survives blur and hard reload",
    6: "After autosave and reload each card once, no conflict or fork",
    7: "/tweet and toolbar land the card at the cursor",
    8: "Pasted link: valid, invalid sentence, 404 sentence",
    9: "Ticker page lists the note",
    10: "390/820/1200: no overflow on sheet or note, Import reachable",
    11: "Flag unset: no button, no slash item, route 404",
    12: "Removal path: one card emptied, take kept, others untouched",
    13: "Extra: click a line and type right after opening a note lands on that line",
}


class Report:
    def __init__(self):
        self.items: dict[int, list[tuple[str, str, str]]] = {n: [] for n in CHECKS}
        self.controls: list[tuple[str, bool, str]] = []
        self.shots: list[str] = []

    def add(self, n: int, status: str, label: str, evidence: str = "") -> None:
        self.items[n].append((status, label, str(evidence)[:600]))
        print(f"  [{n}] {status}: {label} :: {str(evidence)[:300]}", flush=True)

    def check(self, n: int, label: str, ok, evidence="") -> bool:
        self.add(n, "PASS" if ok else "FAIL", label, evidence)
        return bool(ok)

    def control(self, label: str, ok: bool, evidence="") -> None:
        self.controls.append((label, bool(ok), str(evidence)[:300]))
        print(f"  CONTROL {'HELD' if ok else 'BROKEN'}: {label} :: {evidence}", flush=True)

    def status(self, n: int) -> str:
        states = [s for s, _, _ in self.items[n]]
        if not states:
            return "INCONCLUSIVE"
        if "FAIL" in states:
            return "FAIL"
        if "INCONCLUSIVE" in states:
            return "INCONCLUSIVE"
        return "PASS"

    def summary(self) -> str:
        counts = {"PASS": 0, "FAIL": 0, "INCONCLUSIVE": 0}
        for n in CHECKS:
            counts[self.status(n)] += 1
        held = sum(1 for _, ok, _ in self.controls if ok)
        return (f"TOTALS: PASS={counts['PASS']} FAIL={counts['FAIL']} INCONCLUSIVE={counts['INCONCLUSIVE']} "
                f"controls_held={held}/{len(self.controls)}")


# ── browser helpers ──────────────────────────────────────────────────────────────────────────

#: Page-side trace for `--caret-repro`: every transaction that moves the selection or the doc, with
#: the selection before and after, plus the member's input events. Reads the live editor off
#: the DOM (`dom.editor`, which TipTap sets); nothing in the product knows it exists.
CARET_TRACE_JS = r"""(() => {
  if (window.top !== window) return;
  const t0 = performance.now(), log = [];
  window.__caretLog = log;
  const now = () => Math.round(performance.now() - t0);
  const sel = (view) => {
    try { const j = view.state.selection.toJSON(); return j.type + ':' + (j.anchor ?? '') + (j.head != null && j.head !== j.anchor ? '-' + j.head : ''); }
    catch (e) { return 'err'; }
  };
  const seen = new WeakSet(); let editorNo = 0;
  const hook = (dom) => {
    if (seen.has(dom) || !dom.editor || !dom.editor.view) return;
    seen.add(dom);
    const view = dom.editor.view, no = ++editorNo;
    log.push({t: now(), ev: 'editor', no, sel: sel(view), docSize: view.state.doc.content.size,
              focused: view.hasFocus(), firstNode: view.state.doc.firstChild && view.state.doc.firstChild.type.name});
    const orig = view.dispatch.bind(view);
    view.dispatch = (tr) => {
      const before = sel(view), wasFocused = view.hasFocus();
      const out = orig(tr);
      const after = sel(view);
      if (tr.docChanged || tr.selectionSet || after !== before) {
        log.push({t: now(), ev: 'dispatch', no, before, after, docChanged: tr.docChanged, selectionSet: tr.selectionSet,
                  swap: !!tr.getMeta('uctWholeDocumentSwap'), focused: wasFocused,
                  step: tr.steps[0] ? JSON.stringify(tr.steps[0].toJSON()).slice(0, 90) : null,
                  stack: new Error().stack.split('\n').slice(2, 9).map(s => s.trim().replace(/https?:\/\/[^/]+/, '')).join(' < ')});
      }
      return out;
    };
  };
  new MutationObserver(() => document.querySelectorAll('.ProseMirror').forEach(hook))
    .observe(document, {childList: true, subtree: true});
  for (const ev of ['mousedown', 'mouseup', 'keydown', 'focusin', 'focusout']) {
    document.addEventListener(ev, (e) => {
      const t = e.target || {};
      log.push({t: now(), ev, key: e.key, target: (t.tagName || '') + (t.classList && t.classList.contains('ProseMirror') ? '.PM' : '')});
    }, true);
  }
})();"""


def dismiss_intro(page) -> None:
    for attempt in (lambda: page.click('[aria-label="Skip intro"]', timeout=800),
                    lambda: page.click(INTRO_SEL, timeout=800)):
        try:
            attempt()
            page.wait_for_timeout(200)
        except Exception:  # noqa: BLE001
            continue
        if page.query_selector(INTRO_SEL) is None:
            return
    page.wait_for_selector(INTRO_SEL, state="detached", timeout=15000)


def goto(page, url: str) -> None:
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(400)
    dismiss_intro(page)


def text_present(page, text: str) -> bool:
    return bool(page.evaluate("t => document.body.innerText.includes(t)", text))


OVERFLOW_JS = """() => {
  const d = document.documentElement;
  return {scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, overflow: d.scrollWidth > d.clientWidth + 1};
}"""


def overflow(page) -> dict:
    return page.evaluate(OVERFLOW_JS)


STRUCTURE_JS = """() => {
  const pm = document.querySelector('.ProseMirror');
  if (!pm) return null;
  return Array.from(pm.children).map(e => {
    const c = e.querySelector('[data-tweet-card]');
    if (c) return {k: 'card', t: c.innerText.slice(0, 80)};
    return {k: e.tagName, t: (e.innerText || '').slice(0, 80)};
  });
}"""


def structure(page):
    return page.evaluate(STRUCTURE_JS)


def wait_cards(page, n: int, timeout: float = 25000) -> int:
    page.wait_for_function("n => document.querySelectorAll('[data-tweet-card]').length >= n", arg=n, timeout=timeout)
    page.wait_for_timeout(500)
    return page.locator("[data-tweet-card]").count()


def get_note(page, base: str, note_id: str) -> dict:
    return page.request.get(f"{base}/api/j2/notes/{note_id}").json()


def note_body(note: dict):
    note = note.get("note", note) if isinstance(note, dict) else {}
    body = note.get("bodyJson") or note.get("body_json")
    return json.loads(body) if isinstance(body, str) else body


def note_url(base: str, note_id: str) -> str:
    return f"{base}/journal/notebook?note={note_id}"


def excerpt_ids(body) -> list[str]:
    out: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "documentExcerpt":
                out.append(node.get("attrs", {}).get("excerptId"))
            for child in node.get("content") or []:
                walk(child)

    walk(body or {})
    return out


def body_text(body) -> str:
    out: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "text":
                out.append(node.get("text") or "")
            for child in node.get("content") or []:
                walk(child)

    walk(body or {})
    return " ".join(out)


def all_notes(page, base: str) -> list[dict]:
    data = page.request.get(f"{base}/api/j2/notes?limit=200").json()
    return data.get("notes", data) if isinstance(data, dict) else data


def wait_body(page, base: str, note_id: str, pred, timeout_s: float = 30.0):
    deadline = time.time() + timeout_s
    body = None
    while time.time() < deadline:
        body = note_body(get_note(page, base, note_id))
        if pred(body):
            return body
        page.wait_for_timeout(700)
    return body


def dialog(page):
    return page.get_by_role("dialog", name="Import a tweet")


def open_ticker_sheet(page, base: str):
    goto(page, f"{base}/journal/notebook/research/{SYMBOL}")
    page.get_by_role("button", name="Import a tweet").click(timeout=20000)
    dlg = dialog(page)
    dlg.wait_for(timeout=15000)
    return dlg


def rows(dlg):
    return dlg.locator('[role="checkbox"]')


def wait_rows(dlg) -> None:
    dlg.locator('[role="checkbox"]').first.wait_for(timeout=15000)


def row_with(dlg, text: str):
    return dlg.locator('[role="checkbox"]').filter(has_text=text)


def import_button(dlg):
    return dlg.get_by_role("button", name=re.compile(r"^Import( \d+ posts)?$"))


def caret_into_paragraph(page, marker: str) -> None:
    para = page.locator(".ProseMirror p").filter(has_text=marker).first
    para.click()
    page.keyboard.press("End")
    page.wait_for_timeout(150)


# ── the steps ────────────────────────────────────────────────────────────────────────────────

class Smoke:
    def __init__(self, page, base: str, shots: Path, fx: dict, report: Report, stub: StubState, trace: Path):
        self.page, self.base, self.shots, self.fx, self.r, self.stub, self.trace = page, base, shots, fx, report, stub, trace
        self.note_id: str | None = None
        self.save_posts: list[str] = []
        self.note_writes: list[tuple[str, int]] = []
        page.on("request", self._on_request)
        page.on("response", self._on_response)
        self.first_take = "Smoke take: this is the line I care about."

    def _on_request(self, request) -> None:
        if request.method == "POST" and request.url.endswith("/api/j2/research-capture/tweets/save"):
            self.save_posts.append(request.post_data or "")

    def _on_response(self, response) -> None:
        m = response.request.method
        if m in ("PUT", "PATCH", "POST") and re.search(r"/api/j2/notes/[^/]+$", response.url):
            self.note_writes.append((f"{m} {urlsplit(response.url).path}", response.status))

    def shot(self, name: str) -> str:
        path = self.shots / f"{name}.png"
        self.page.screenshot(path=str(path), full_page=False)
        self.r.shots.append(str(path))
        return str(path)

    def need_note(self, n: int) -> bool:
        if self.note_id:
            return True
        self.r.add(n, "INCONCLUSIVE", "needs the note from check 3, which did not produce one")
        return False

    def controls(self) -> None:
        page = self.page
        absent = "ZZZ-smoke-sentinel-absent-from-every-page"
        self.r.control("a text that is absent is reported absent", text_present(page, absent) is False,
                       f"text_present({absent!r}) = {text_present(page, absent)}")
        page.evaluate("""() => { const d = document.createElement('div'); d.id = '__smoke_wide';
          d.style.cssText = 'width:4000px;height:1px;position:relative'; document.body.appendChild(d); }""")
        wide = overflow(page)
        page.evaluate("() => document.getElementById('__smoke_wide').remove()")
        self.r.control("the overflow measure reports an injected 4000px element", wide["overflow"] is True, wide)

    def step1(self) -> None:
        page, r = self.page, self.r
        goto(page, f"{self.base}/journal/notebook/research/{SYMBOL}")
        importer = page.get_by_role("button", name="Import a tweet")
        importer.wait_for(timeout=20000)
        transcript = page.get_by_role("button", name=re.compile("Save from a transcript"))
        have = transcript.count() > 0
        r.check(1, "Save from a transcript is on the page", have, f"count={transcript.count()}")
        r.check(1, "Import a tweet is visible", importer.is_visible())
        if have:
            a, b = transcript.first.bounding_box(), importer.bounding_box()
            same_row = abs((a["y"] + a["height"] / 2) - (b["y"] + b["height"] / 2)) < 12
            r.check(1, "beside it (same row, Import to the right)", same_row and b["x"] > a["x"],
                    f"transcript={a} import={b}")
        r.check(1, "screenshot", True, self.shot("01-ticker-page"))

    def step2(self) -> None:
        page, r = self.page, self.r
        page.set_viewport_size({"width": 1600, "height": 1000})
        page.get_by_role("button", name="Import a tweet").click(timeout=15000)
        dlg = dialog(page)
        dlg.wait_for(timeout=15000)
        wait_rows(dlg)
        nvda_rows = rows(dlg).count()
        r.check(2, "ticker scope lists the NVDA posts", nvda_rows >= 6, f"rows={nvda_rows}")
        r.check(2, "ticker scope excludes the AMD-only post", row_with(dlg, "raises its data center").count() == 0,
                "AMD-only row absent")
        r.check(2, "screenshot at 1600 wide", True, self.shot("02-sheet-1600"))

        dlg.get_by_role("button", name="All recent").click()
        page.wait_for_timeout(1500)
        r.check(2, "All recent brings in the AMD post", row_with(dlg, "raises its data center").count() == 1,
                f"rows={rows(dlg).count()}")
        dlg.get_by_role("button", name=f"${SYMBOL}").click()
        page.wait_for_timeout(1500)
        r.check(2, "ticker chip returns to NVDA only", row_with(dlg, "raises its data center").count() == 0,
                f"rows={rows(dlg).count()}")

        dlg.get_by_role("button", name="Headlines").click()
        page.wait_for_timeout(400)
        kept = rows(dlg).count()
        r.check(2, "Headlines keeps only news accounts", kept >= 1 and row_with(dlg, "Marlin Desk").count() == 0,
                f"rows={kept}")
        dlg.get_by_role("button", name="Headlines").click()
        page.wait_for_timeout(400)

        dlg.get_by_placeholder("Search name or words").fill("supplier checks")
        page.wait_for_timeout(400)
        r.check(2, "search narrows to the matching post", rows(dlg).count() == 1, f"rows={rows(dlg).count()}")
        dlg.get_by_placeholder("Search name or words").fill("")
        page.wait_for_timeout(300)

    def step3(self) -> None:
        page, r = self.page, self.r
        dlg = dialog(page)
        row_with(dlg, "supplier checks").click()
        row_with(dlg, "midday pullback").click()
        go = import_button(dlg)
        r.check(3, "Import button counts two", (go.inner_text() or "").strip() == "Import 2 posts", go.inner_text())
        go.click()
        page.get_by_label("My take", exact=False).first.wait_for(timeout=30000)
        dlg.wait_for(state="detached", timeout=15000)
        page.wait_for_timeout(1500)
        r.check(3, "two cards in the opened note", wait_cards(page, 2) == 2, page.url)
        if self.save_posts:
            self.note_id = json.loads(self.save_posts[0])["noteId"]
        r.check(3, "a note id came back on the save", bool(self.note_id), self.note_id)
        focus = page.evaluate("""() => {
          const a = document.activeElement;
          const cards = Array.from(document.querySelectorAll('[data-tweet-card]'));
          return {tag: a && a.tagName, firstCardHoldsIt: !!(cards[0] && cards[0].contains(a)),
                  placeholder: a && a.placeholder};
        }""")
        r.check(3, "cursor is in the first card's My take",
                focus["tag"] == "TEXTAREA" and focus["firstCardHoldsIt"], focus)
        title_ok = text_present(page, NOTE_TITLE) or page.locator(f'input[value="{NOTE_TITLE}"]').count() > 0
        r.check(3, "the new note has the ticker title", title_ok, NOTE_TITLE)

    def step4(self) -> None:
        page, r, fx = self.page, self.r, self.fx
        if not self.need_note(4):
            return
        body = self.save_posts[0] if self.save_posts else ""
        parsed = json.loads(body) if body else {}
        r.check(4, "/save carries exactly noteId and tweetIds", set(parsed) == {"noteId", "tweetIds"}, body[:200])
        r.check(4, "/save carries no post text",
                not any(w in body for w in ("supplier", "midday", "Tape Parrot", "tape_parrot", "$NVDA")), body[:200])
        r.check(4, "/save ids are the ticked posts in ticked order", parsed.get("tweetIds") == [P1, P4], parsed.get("tweetIds"))

        cards = page.locator("[data-tweet-card]")
        first = cards.nth(0)
        text = first.inner_text()
        r.check(4, "card 1 name and handle", "Tape Parrot" in text and "@tape_parrot" in text, text[:120])
        r.check(4, "card 1 post text", "supplier checks point to another strong quarter" in text, text[:160])
        cash = first.locator("[data-cashtag]").first
        color = cash.evaluate("e => getComputedStyle(e).color")
        nums = [float(x) for x in re.findall(r"[\d.]+", color)[:3]]
        goldish = len(nums) == 3 and nums[0] > 150 and nums[1] > 110 and nums[2] < nums[0] - 40
        r.check(4, "cashtag is gold", goldish, f"{cash.inner_text()} {color}")
        first.locator("img").first.wait_for(timeout=8000)
        loaded = first.locator(".cimg img, img[alt='Attached to the post']").first
        for _ in range(20):
            if loaded.evaluate("e => e.complete && e.naturalWidth"):
                break
            page.wait_for_timeout(300)
        natural = loaded.evaluate("e => e.naturalWidth")
        src = loaded.get_attribute("src") or ""
        r.check(4, "seeded image shows, copied to the note", natural > 0 and src.startswith("/api/j2/notes/attachments/"),
                f"naturalWidth={natural} src={src}")
        r.check(4, "time shows", bool(re.search(r"\d{1,2}:\d{2}", text)), re.findall(r".{0,24}\d{1,2}:\d{2}.{0,8}", text)[:1])
        link = first.get_by_role("link", name="View on X")
        href = link.get_attribute("href") or ""
        r.check(4, "View on X links the post", f"/status/{P1}" in href, href)

        expected = f"$NVDA when posted ${fx['p1_price']:.2f}"
        r.check(4, "card 1 price is the seeded 5m close", expected in text, f"want {expected!r} in {text[:300]!r}")
        now_part = re.search(r"Now \$[\d,.]+", text)
        r.check(4, "card 1 shows Now and the % since (snapshot answered at the browser)",
                bool(now_part) and "since" in text, text[-160:])

        look = first.evaluate("""card => {
          const font = (e) => getComputedStyle(e).fontFamily;
          const img = card.querySelector("img[alt='Attached to the post']");
          const take = card.querySelector('textarea');
          const box = card.getBoundingClientRect();
          return {width: box.width, imgHeight: img.getBoundingClientRect().height,
                  fit: getComputedStyle(img).objectFit, card: font(card), take: font(take),
                  name: font(card.querySelector('[class*="name"]')), text: font(card.querySelector('[class*="ctext"]')),
                  handle: font(card.querySelector('[class*="handle"]'))};
        }""")
        fonts = [look[k] for k in ("card", "name", "handle", "text", "take")]
        r.check(4, "card is capped at 740px wide", look["width"] <= 740.5, look)
        r.check(4, "image is at most 420px tall and letterboxed", look["imgHeight"] <= 420.5 and look["fit"] == "contain", look)
        r.check(4, "name, handle, text and My take are in the app's sans face",
                all("Instrument Sans" in f for f in fonts), look)

        second = cards.nth(1).inner_text()
        day = (fx["thu"] - timedelta(days=1)).strftime("%b %-d") if os.name != "nt" else (fx["thu"] - timedelta(days=1)).strftime("%b %#d")
        want = f"${fx['p4_close']:.2f}"
        r.check(4, "card 2 falls back to the seeded daily close (through _fetch_bars)",
                "close on" in second and want in second and day in second, f"want 'close on {day}' and {want} in {second[:300]!r}")

        calls = [json.loads(line) for line in self.trace.read_text().splitlines()] if self.trace.exists() else []
        nvda_5m = [c for c in calls if c["symbol"] == "NVDA" and c["tf"] == "5"]
        if not nvda_5m:
            r.add(4, "INCONCLUSIVE", "_fetch_bars NVDA 5m was never called", calls[:3])
        else:
            c = nvda_5m[0]
            r.check(4, "_fetch_bars ran through serve_bars and parsed seeded rows", c["rows"] >= 70, c)
        r.check(4, "screenshot", True, self.shot("04-cards"))

    def step5(self) -> None:
        page, r = self.page, self.r
        if not self.need_note(5):
            return
        field = page.locator("[data-tweet-card]").first.locator("textarea")
        field.click()
        field.fill(self.first_take)
        with page.expect_response(lambda resp: "/api/j2/excerpts/" in resp.url and resp.request.method == "PATCH", timeout=15000) as info:
            page.locator(".ProseMirror p").first.click() if page.locator(".ProseMirror p").count() else page.mouse.click(5, 5)
        r.check(5, "blur saved the take (PATCH 2xx)", 200 <= info.value.status < 300, info.value.status)
        page.wait_for_timeout(800)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        dismiss_intro(page)
        wait_cards(page, 2)
        value = page.locator("[data-tweet-card]").first.locator("textarea").input_value()
        r.check(5, "the take is back after hard reload", value == self.first_take, value)

    def step6(self) -> None:
        page, r, base = self.page, self.r, self.base
        if not self.need_note(6):
            return
        marker = "Smoke autosave paragraph"
        editable = page.locator(".ProseMirror p")
        if editable.count():
            editable.last.click()
        else:
            page.locator(".ProseMirror").click()
        page.keyboard.press("End")
        page.keyboard.type(marker, delay=8)
        body = wait_body(page, base, self.note_id, lambda b: marker in body_text(b))
        r.check(6, "the typed paragraph reached the server by autosave", marker in body_text(body), body_text(body)[:200])
        statuses = [s for _, s in self.note_writes]
        r.check(6, "no note write answered 409", 409 not in statuses, self.note_writes[-6:])
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        dismiss_intro(page)
        count = wait_cards(page, 2)
        body = note_body(get_note(page, base, self.note_id))
        ids = excerpt_ids(body)
        r.check(6, "exactly two cards after reload", count == 2, structure(page))
        r.check(6, "the saved body has each excerpt once", len(ids) == 2 and len(set(ids)) == 2, ids)
        r.check(6, "no conflict or fork notice on the page", not any(text_present(page, w) for w in FORK_WORDS), FORK_WORDS)
        titles = [n.get("title") for n in all_notes(page, base)]
        forks = [t for t in titles if t and "conflicted copy" in t.lower()]
        r.check(6, "no conflicted copy in the note list", not forks, titles[:10])

    def _pick_and_import(self, match_text: str) -> None:
        dlg = dialog(self.page)
        wait_rows(dlg)
        row_with(dlg, match_text).click()
        import_button(dlg).click()
        dlg.wait_for(state="detached", timeout=20000)

    def step7(self) -> None:
        page, r, base = self.page, self.r, self.base
        if not self.need_note(7):
            return
        # Below the existing cards: the autosave paragraph, then an anchor, then a tail. The caret
        # goes on the anchor's line, so "at the cursor" and "at the end of the note" differ.
        anchor, tail = "Smoke caret anchor", "Smoke tail paragraph"
        page.locator(".ProseMirror p").last.click()
        page.keyboard.press("End")
        for text in (anchor, tail):
            page.keyboard.press("Enter")
            page.keyboard.type(text, delay=8)
        page.wait_for_timeout(400)
        placed = structure(page)
        print(f"  [7] structure before /tweet: {placed}", flush=True)
        order = [n["t"] if n["k"] != "card" else "card" for n in placed]
        typed_below = order[-2:] == [anchor, tail] or order[-3:-1] == [anchor, tail]
        r.check(7, "the anchor and tail paragraphs sit below the existing cards", typed_below, placed)

        def between(after, snippet):
            at = next((i for i, n in enumerate(after) if n["k"] != "card" and anchor in n["t"]), None)
            end = next((i for i, n in enumerate(after) if n["k"] != "card" and tail in n["t"]), None)
            card = next((i for i, n in enumerate(after) if n["k"] == "card" and snippet in n["t"]), None)
            return at is not None and end is not None and card is not None and at < card < end

        start = page.locator("[data-tweet-card]").count()
        caret_into_paragraph(page, anchor)
        page.keyboard.press("Enter")        # a member's /tweet starts a fresh line
        page.keyboard.type("/tweet", delay=30)
        option = page.get_by_role("option", name=re.compile(r"^Tweet"))
        option.first.wait_for(timeout=10000)
        r.check(7, "/tweet shows the Tweet item", option.count() >= 1, option.first.inner_text())
        option.first.click()
        self._pick_and_import("tight flag on the 65 minute")
        wait_cards(page, start + 1)
        after = structure(page)
        print(f"  [7] structure after /tweet: {after}", flush=True)
        r.check(7, "/tweet: the card lands between the caret line and the tail, not at the end",
                between(after, "tight flag"), after)
        r.check(7, "/tweet command text is gone", not any("/tweet" in n["t"] for n in after), after)
        r.check(7, "screenshot after /tweet", True, self.shot("07-tweet-at-cursor"))

        caret_into_paragraph(page, anchor)
        toolbar = page.get_by_title("Import a tweet")
        r.check(7, "toolbar button is there", toolbar.count() >= 1, toolbar.count())
        toolbar.first.click()
        self._pick_and_import("Sizing down")
        wait_cards(page, start + 2)
        after = structure(page)
        print(f"  [7] structure after toolbar: {after}", flush=True)
        r.check(7, "toolbar: the card lands between the caret line and the tail, not at the end",
                between(after, "Sizing down"), after)

        saved = wait_body(page, base, self.note_id, lambda b: len(excerpt_ids(b)) >= start + 2 and tail in body_text(b))
        ids = excerpt_ids(saved)
        r.check(7, "the saved body holds each card once (none doubled by the server's own placement)",
                len(ids) == start + 2 and len(set(ids)) == len(ids), ids)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        dismiss_intro(page)
        count = wait_cards(page, start + 2)
        persisted = structure(page)
        print(f"  [7] structure after reload: {persisted}", flush=True)
        r.check(7, "reload: every card once, the new ones still at the caret",
                count == start + 2 and between(persisted, "Sizing down") and between(persisted, "tight flag"), persisted)

    def step8(self) -> None:
        page, r = self.page, self.r
        if not self.need_note(8):
            return
        toolbar = page.get_by_title("Import a tweet")
        start = wait_cards(page, 1)
        toolbar.first.click()
        dlg = dialog(page)
        dlg.wait_for(timeout=15000)
        wait_rows(dlg)
        link_input = dlg.get_by_label("Link to a post on X")

        link_input.fill(f"https://x.com/harbor_watch/status/{LINK_OK}")
        group = dlg.get_by_role("group", name="From your link")
        group.wait_for(timeout=15000)
        row = group.locator('[role="checkbox"]').first
        row.wait_for(timeout=15000)
        r.check(8, "valid link shows under From your link", "pasted by a member" in row.inner_text(), row.inner_text()[:120])
        r.check(8, "valid link is ticked", row.get_attribute("aria-checked") == "true", row.get_attribute("aria-checked"))
        r.check(8, "stub was asked by id only", [LINK_OK] in self.stub.calls, self.stub.calls[-3:])
        import_button(dlg).click()
        dlg.wait_for(state="detached", timeout=20000)
        count = wait_cards(page, start + 1)
        r.check(8, "the linked post imported as a card", count == start + 1, count)

        toolbar.first.click()
        dlg = dialog(page)
        dlg.wait_for(timeout=15000)
        link_input = dlg.get_by_label("Link to a post on X")
        link_input.fill("https://example.com/not-a-post")
        err = dlg.locator('[role="alert"]')
        err.first.wait_for(timeout=8000)
        r.check(8, "invalid link: the exact sentence", err.first.inner_text() == NOT_A_LINK, err.first.inner_text())

        link_input.fill(f"https://x.com/harbor_watch/status/{LINK_GONE}")
        page.wait_for_function(
            "m => Array.from(document.querySelectorAll('[role=dialog] [role=alert]')).some(e => e.textContent === m)",
            arg=NOT_FOUND, timeout=15000)
        shown = [e.inner_text() for e in dlg.locator('[role="alert"]').all()]
        r.check(8, "gone link: the 404 sentence", NOT_FOUND in shown, shown)
        r.check(8, "screenshot of the refusal", True, self.shot("08-link-refused"))
        dlg.get_by_role("button", name="Close").first.click()
        dlg.wait_for(state="detached", timeout=8000)

    def step9(self) -> None:
        page, r = self.page, self.r
        if not self.need_note(9):
            return
        goto(page, f"{self.base}/journal/notebook/research/{SYMBOL}")
        page.wait_for_function("t => document.body.innerText.includes(t)", arg=NOTE_TITLE, timeout=20000)
        r.check(9, "the imported note is listed", text_present(page, NOTE_TITLE), NOTE_TITLE)
        r.check(9, "screenshot", True, self.shot("09-ticker-page-lists-note"))

    def step10(self) -> None:
        page, r, base = self.page, self.r, self.base
        if not self.need_note(10):
            return
        for width in (390, 820, 1200):
            page.set_viewport_size({"width": width, "height": 844 if width == 390 else 1000})
            dlg = open_ticker_sheet(page, base)
            wait_rows(dlg)
            page.wait_for_timeout(600)
            row = rows(dlg).first
            row.click()
            page.wait_for_timeout(250)
            over = overflow(page)
            r.check(10, f"{width}: sheet has no horizontal overflow", not over["overflow"], over)
            go = import_button(dlg)
            go.scroll_into_view_if_needed(timeout=5000)
            box = go.bounding_box()
            reach = page.evaluate("""([x, y]) => {
              const e = document.elementFromPoint(x, y);
              return !!(e && e.closest('button') && /Import/.test(e.closest('button').textContent));
            }""", [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2])
            inside = box["y"] >= 0 and box["y"] + box["height"] <= page.viewport_size["height"]
            r.check(10, f"{width}: Import button is reachable", reach and inside, {"box": box, "hit": reach})
            r.check(10, f"{width}: screenshot of the sheet", True, self.shot(f"10-sheet-{width}"))
            dlg.get_by_role("button", name="Close").first.click()
            dlg.wait_for(state="detached", timeout=8000)

            goto(page, note_url(base, self.note_id))
            cards = wait_cards(page, 2, timeout=30000)
            page.wait_for_timeout(600)
            over = overflow(page)
            r.check(10, f"{width}: note with {cards} cards has no horizontal overflow", not over["overflow"], over)
            r.check(10, f"{width}: screenshot of the note", True, self.shot(f"10-note-{width}"))
        page.set_viewport_size({"width": 1600, "height": 1000})

    def step12(self, smoke_env: dict) -> None:
        page, r = self.page, self.r
        if not self.need_note(12):
            return
        self.stub.gone.add(P4)
        before_calls = len(self.stub.calls)
        out = subprocess.run([sys.executable, str(Path(__file__)), "--removal"], cwd=str(ROOT), env=smoke_env,
                             capture_output=True, text=True, timeout=300)
        line = next((ln for ln in out.stdout.splitlines() if ln.startswith("REMOVAL")), None)
        if line is None:
            r.add(12, "INCONCLUSIVE", "removal child printed no result", (out.stdout[-400:] + out.stderr[-400:]))
            return
        result = json.loads(line[len("REMOVAL"):])
        print("  [12] " + json.dumps(result), flush=True)
        sweep, confirm = result["sweep"], result["confirm"]
        r.check(12, "sweep checked saved posts and marked exactly one", sweep.get("marked") == 1 and sweep.get("missed") == 1
                and not sweep.get("outage") and not sweep.get("bulk_guard"), sweep)
        r.check(12, "confirm removed exactly one, with live canaries", confirm.get("removed") == 1 and confirm.get("canaries", 0) >= 1
                and not confirm.get("outage"), confirm)
        calls = self.stub.calls[before_calls:]
        r.check(12, "both passes asked the stub about the gone post", sum(P4 in c for c in calls) == 2, calls)

        goto(page, note_url(self.base, self.note_id))
        wait_cards(page, 2, timeout=30000)
        page.wait_for_timeout(600)
        cards = page.locator("[data-tweet-card]")
        by_text = [cards.nth(i).inner_text() for i in range(cards.count())]
        gone = [t for t in by_text if POST_GONE in t]
        r.check(12, "exactly one card says the post is gone", len(gone) == 1, [t[:80] for t in by_text])
        if gone:
            r.check(12, "the gone card's words are gone", "midday pullback" not in gone[0], gone[0][:200])
            r.check(12, "the gone card keeps author, link and time",
                    "North Ledger" in gone[0] and "View on X" in gone[0], gone[0][:200])
        kept = page.locator("[data-tweet-card]").filter(has_text="Tape Parrot").locator("textarea").input_value()
        r.check(12, "the take is kept", kept == self.first_take, kept)
        scan_notice = [e.inner_text() for e in page.locator('[aria-label="Attachment text status"]').all()]
        r.check(12, "the note does not call the removed post a scanned file",
                not any("scan" in t.lower() for t in scan_notice) and not text_present(page, "looks like a scan"),
                scan_notice or "no attachment status shown")
        others = [t for t in by_text if POST_GONE not in t]
        r.check(12, "the other cards are untouched",
                len(others) == len(by_text) - 1 and len(others) >= 1 and any("supplier checks" in t for t in others),
                [t[:60] for t in others])
        r.check(12, "screenshot", True, self.shot("12-removed-card"))

    def _caret_rounds(self, url: str, label: str, settle_ms: int, rounds: int, want_cards: int) -> list[dict]:
        """Reload, click the last paragraph, type straight away. Reports where the words landed.
        Never cleans up: a stray keystroke here can have replaced a card, and a Backspace would
        take more."""
        page = self.page
        out = []
        for round_no in range(1, rounds + 1):
            # Both misses seen so far came on the first reload after a save moved the note, so
            # each round makes that happen: edit, wait for the save, reload, click, type.
            goto(page, url)
            page.locator(".ProseMirror p").last.wait_for(timeout=30000)
            page.locator(".ProseMirror p").last.click()
            page.keyboard.press("End")
            with page.expect_response(lambda resp: resp.request.method in ("PUT", "PATCH")
                                      and re.search(r"/api/j2/notes/[^/]+$", resp.url), timeout=20000):
                page.keyboard.type(".", delay=5)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(400)
            dismiss_intro(page)
            page.locator(".ProseMirror p").last.wait_for(timeout=30000)
            if want_cards:
                wait_cards(page, 1, timeout=30000)
            if settle_ms:
                page.wait_for_timeout(settle_ms)
            before = structure(page)
            page.locator(".ProseMirror p").last.click()
            page.keyboard.press("End")
            probe = f"probe-{label}-{settle_ms}-{round_no}"
            page.keyboard.type(probe, delay=5)
            page.wait_for_timeout(300)
            after = structure(page)
            # The whole line, not `structure`'s 80 character preview: probes pile up on one line.
            where = page.evaluate("""p => {
              const kids = Array.from(document.querySelector('.ProseMirror').children);
              const i = kids.findIndex(e => e.textContent.includes(p));
              return i < 0 ? null : i;
            }""", probe)
            lines = [i for i, n in enumerate(after) if n["k"] != "card"]
            on_last = where is not None and where == (lines[-1] if lines else None)
            cards_before = sum(1 for n in before if n["k"] == "card")
            cards_after = sum(1 for n in after if n["k"] == "card")
            out.append({"label": label, "settle_ms": settle_ms, "round": round_no, "on_last_line": on_last,
                        "at": where, "of": len(after), "cards_before": cards_before, "cards_after": cards_after})
            print(f"  [13] {out[-1]}", flush=True)
            page.wait_for_timeout(2500)      # let the autosave settle before the next reload
        return out

    def step13(self) -> None:
        """Not one of the 12: a defect found by the smoke, measured with a control."""
        page, r, base = self.page, self.r, self.base
        if not self.need_note(13):
            return
        body = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": f"Smoke plain paragraph {i}"}]} for i in range(3)]}
        made = page.request.post(f"{base}/api/j2/notes", data={"title": "Smoke plain note", "bodyJson": body, "ticker": SYMBOL})
        plain = made.json().get("note", made.json())
        plain_id = plain.get("id")
        r.check(13, "a plain control note was created", bool(plain_id), made.status)

        cards_url, plain_url = note_url(base, self.note_id), note_url(base, plain_id)
        immediate = self._caret_rounds(cards_url, "cards", 0, 4, 1)
        settled = self._caret_rounds(cards_url, "cards", 4000, 3, 1)
        control = self._caret_rounds(plain_url, "plain", 0, 3, 0)
        misses = [x for x in immediate if not x["on_last_line"]]
        lost = [x for x in immediate if x["cards_after"] < x["cards_before"]]
        r.check(13, "note with cards: typing straight after opening lands on the clicked line, 4 of 4",
                not misses, {"misses": misses, "cards_lost_rounds": len(lost), "rounds": immediate})
        r.check(13, "note with cards: typing after a 4 s settle lands on the clicked line, 3 of 3",
                all(x["on_last_line"] for x in settled), settled)
        r.check(13, "plain note control: typing straight after opening lands on the clicked line, 3 of 3",
                all(x["on_last_line"] for x in control), control)
        if misses:
            r.check(13, "screenshot of the note after a miss", True, self.shot("13-caret-miss"))

    def caret_round(self, variant: str, round_no: int, misses_path: Path) -> dict:
        """One note, opened fresh: reload, click the last line, type at once. Returns where the
        words landed. `cards` is a real imported note, `hr` opens with a horizontal rule (an atom
        that has nothing to do with this feature), `paragraph` opens with text."""
        page, base = self.page, self.base
        para = {"type": "paragraph", "content": [{"type": "text", "text": "Smoke line"}]}
        bodies = {"hr": [{"type": "horizontalRule"}, para, para], "paragraph": [para, para, para]}
        kind = variant.split("-")[0]
        if kind == "cards":
            note_id = page.request.post(f"{base}/api/j2/notes", data={"title": f"caret {round_no}", "ticker": SYMBOL}).json()
            note_id = note_id.get("note", note_id)["id"]
            for _ in range(8):
                saved = page.request.post(f"{base}/api/j2/research-capture/tweets/save",
                                          data={"noteId": note_id, "tweetIds": [P2, P6]})
                if saved.status != 429:
                    break
                time.sleep(4)
            if saved.status != 200:
                raise RuntimeError(f"save answered {saved.status}")
        else:
            made = page.request.post(f"{base}/api/j2/notes", data={
                "title": f"caret {round_no}", "bodyJson": {"type": "doc", "content": bodies[kind]}}).json()
            note_id = made.get("note", made)["id"]
        goto(page, note_url(base, note_id))
        page.locator(".ProseMirror p").last.wait_for(timeout=30000)
        if not variant.endswith("nosave"):
            page.locator(".ProseMirror p").last.click()
            page.keyboard.press("End")
            with page.expect_response(lambda resp: resp.request.method in ("PUT", "PATCH")
                                      and re.search(r"/api/j2/notes/[^/]+$", resp.url), timeout=20000):
                page.keyboard.type(".", delay=5)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(400)
            dismiss_intro(page)
            page.locator(".ProseMirror p").last.wait_for(timeout=30000)
        if kind == "cards":
            wait_cards(page, 2, timeout=30000)
        before = structure(page)
        page.locator(".ProseMirror p").last.click()
        page.keyboard.press("End")
        probe = f"probe-{variant}-{round_no}"
        page.keyboard.type(probe, delay=5)
        page.wait_for_timeout(300)
        after = structure(page)
        where = page.evaluate("""p => { const k = Array.from(document.querySelector('.ProseMirror').children);
          const i = k.findIndex(e => e.textContent.includes(p)); return i < 0 ? null : i; }""", probe)
        lines = [i for i, n in enumerate(after) if n["k"] != "card"]
        hit = where is not None and where == (lines[-1] if lines else None)
        out = {"variant": variant, "round": round_no, "hit": hit, "at": where, "of": len(after),
               "cards_before": sum(1 for n in before if n["k"] == "card"),
               "cards_after": sum(1 for n in after if n["k"] == "card"), "note": note_id}
        if not hit or round_no == 1:
            with open(misses_path, "a", encoding="utf-8") as f:
                f.write(json.dumps({**out, "trace": page.evaluate("() => window.__caretLog"), "structure": after}) + "\n")
        return out

    def caret_repro(self, rounds: int, run: Path) -> int:
        """`--caret-repro N`: N rounds per variant, printed and counted."""
        misses_path = run / "caret-trace.jsonl"
        counts = {}
        for variant in ("cards", "cards-nosave", "hr", "paragraph"):
            hits = misses = lost = errors = 0
            for round_no in range(1, rounds + 1):
                try:
                    one = self.caret_round(variant, round_no, misses_path)
                except Exception as e:  # noqa: BLE001 -- count it, keep going
                    errors += 1
                    print(f"  [caret] {variant} {round_no}: ERROR {type(e).__name__}: {str(e)[:160]}", flush=True)
                    continue
                print(f"  [caret] {one}", flush=True)
                hits += one["hit"]
                misses += not one["hit"]
                lost += one["cards_after"] < one["cards_before"]
            counts[variant] = {"rounds": rounds, "hit": hits, "miss": misses, "cards_lost": lost, "errors": errors}
        print("CARET_REPRO " + json.dumps(counts), flush=True)
        print(f"  trace: {misses_path}", flush=True)
        return sum(c["miss"] + c["errors"] for c in counts.values())

    def step11(self, base: str) -> None:
        page, r = self.page, self.r
        if not self.need_note(11):
            return
        page.set_viewport_size({"width": 1600, "height": 1000})
        goto(page, f"{base}/journal/notebook/research/{SYMBOL}")
        page.get_by_role("button", name=re.compile("Start a|New note|Thesis|Save from a transcript")).first.wait_for(timeout=20000)
        r.check(11, "no Import a tweet button on the ticker page",
                page.get_by_role("button", name="Import a tweet").count() == 0, page.url)
        r.check(11, "screenshot", True, self.shot("11-flag-off"))

        goto(page, note_url(base, self.note_id))
        page.locator(".ProseMirror").wait_for(timeout=30000)
        page.wait_for_timeout(1000)
        page.locator(".ProseMirror p").first.click()
        page.keyboard.press("End")
        page.keyboard.type("/tweet", delay=20)
        page.wait_for_timeout(1200)
        options = [o.inner_text() for o in page.get_by_role("option").all()]
        r.check(11, "no slash item for /tweet", not any(o.startswith("Tweet") for o in options), options[:8])
        page.keyboard.press("Escape")
        for _ in range(6):
            page.keyboard.press("Backspace")
        r.check(11, "no toolbar button", page.get_by_title("Import a tweet").count() == 0, "")
        recent = page.request.get(f"{base}/api/j2/research-capture/tweets/recent?scope=all")
        r.check(11, "recent route answers 404", recent.status == 404, recent.status)
        resolve = page.request.post(f"{base}/api/j2/research-capture/tweets/resolve",
                                    data={"url": f"https://x.com/h/status/{LINK_OK}"})
        r.check(11, "resolve route answers 404", resolve.status == 404, resolve.status)
        me = page.request.get(f"{base}/api/auth/me").json()
        r.check(11, "/api/auth/me says the flag is off", me.get("notebook_tweet_import_enabled") is False,
                me.get("notebook_tweet_import_enabled"))


# ── the run ──────────────────────────────────────────────────────────────────────────────────

def http_status(url: str, timeout: float = 5.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:  # noqa: BLE001
        return None


class Server:
    def __init__(self, env: dict, port: int, log: Path):
        self.env, self.port, self.log = env, port, log
        self.proc = None

    def start(self) -> None:
        assert_sandboxed(self.env)
        Path(self.env["SMOKE_SEED_MARK"]).unlink(missing_ok=True)
        out = open(self.log, "ab")
        self.proc = subprocess.Popen([sys.executable, str(Path(__file__)), "--serve", "--port", str(self.port)],
                                     cwd=str(ROOT), env=self.env, stdout=out, stderr=subprocess.STDOUT)
        print(f"  server pid {self.proc.pid} on port {self.port}", flush=True)

    def wait(self, timeout_s: int = 300) -> None:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(f"server exited early with {self.proc.returncode}; see {self.log}")
            mark = Path(self.env["SMOKE_SEED_MARK"])
            if http_status(f"http://127.0.0.1:{self.port}/api/health") == 200 and mark.exists():
                state = mark.read_text(encoding="utf-8")
                if state != "ok":
                    raise RuntimeError(f"seeding failed: {state}")
                return
            time.sleep(2)
        raise RuntimeError(f"server did not answer and seed in {timeout_s}s; see {self.log}")

    def stop(self) -> None:
        if self.proc is None or self.proc.poll() is not None:
            return
        self.proc.terminate()
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=15)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def derive_pins(tmp: Path) -> dict:
    env = dict(os.environ, TEMP=str(tmp), TMP=str(tmp), TMPDIR=str(tmp))
    code = "import conftest, json; print('PINS' + json.dumps(conftest.SHARED_DATA_ENV_PINS))"
    out = subprocess.run([sys.executable, "-c", code], cwd=str(ROOT), env=env, capture_output=True, text=True, timeout=180)
    line = next((ln for ln in out.stdout.splitlines() if ln.startswith("PINS")), None)
    if line is None:
        raise SystemExit(f"could not derive pins: {out.stderr[-800:]}")
    return json.loads(line[4:])


def build_env(sandbox: Path, tmp: Path, pins: dict, stub_port: int, flag_on: bool, t0: float, run: Path) -> dict:
    env = dict(os.environ)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID",
              "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID", "ALLOW_LOCAL_VENDOR_SOCKETS"):
        env.pop(k, None)
    secret = re.compile(r"(API_?KEY|TOKEN|SECRET|PASSWORD|WEBHOOK|ACCESS_KEY|DSN|_KEY$)", re.I)
    for k in list(env):
        if secret.search(k):
            env[k] = ""
    for var, literal in pins.items():
        tail = literal.replace("\\", "/").strip("/")
        if tail != "data" and not tail.startswith("data/"):
            raise SystemExit(f"unexpected pin {var}={literal}")
        rel = tail[len("data"):].strip("/")
        env[var] = str(sandbox.joinpath(*rel.split("/"))) if rel else str(sandbox)
    env.update({
        "TEMP": str(tmp), "TMP": str(tmp), "TMPDIR": str(tmp),
        "PYTHONUNBUFFERED": "1", "COMING_SOON_MODE": "0",
        "TWITTERAPI_IO_BASE_URL": f"http://127.0.0.1:{stub_port}", "TWITTERAPI_IO_API_KEY": "stub-key-not-real",
        "NOTEBOOK_CONFLICT_UX_ON": "1", "NOTEBOOK_OFFLINE_READ_ON": "1", "NOTEBOOK_ATTACHMENTS_ON": "1",
        "SMOKE_AUTH_DB": str(sandbox / "auth.db"), "SMOKE_T0": str(t0),
        "SMOKE_DENIED_LOG": str(run / "outbound-denied.jsonl"), "SMOKE_FETCH_TRACE": str(run / "fetch-bars.jsonl"),
        "SMOKE_SEED_MARK": str(run / "seed.done"), "SMOKE_GUARD_RESULT": str(run / "guard-selftest.json"),
    })
    if flag_on:
        env["NOTEBOOK_TWEET_IMPORT_ENABLED"] = "1"
    else:
        env.pop("NOTEBOOK_TWEET_IMPORT_ENABLED", None)
    return env


def live_fingerprint() -> dict:
    out = {}
    for name in ("auth.db", "tweets.db", "bars.db"):
        p = Path("C:/data") / name
        out[name] = (p.stat().st_mtime, p.stat().st_size) if p.exists() else None
    return out


def wire_browser(context, base: str, png: bytes, blocked: list[str]) -> None:
    host = urlsplit(base).netloc

    def handle(route):
        url = route.request.url
        parts = urlsplit(url)
        if parts.scheme in ("data", "blob"):
            return route.continue_()
        if parts.netloc == host:
            if re.search(r"/api/snapshot/[A-Za-z.\-]+$", parts.path):
                return route.fulfill(status=200, content_type="application/json",
                                     body=json.dumps({"close": 195.5, "ext_price": None}))
            return route.continue_()
        if parts.hostname == IMG_HOST:
            return route.fulfill(status=200, content_type="image/png", body=png)
        blocked.append(url)
        return route.abort()

    context.route("**/*", handle)


def login(page, base: str) -> None:
    page.goto(base, wait_until="domcontentloaded", timeout=60000)
    signup = page.request.post(f"{base}/api/auth/signup",
                               data={"email": EMAIL, "password": PASSWORD, "display_name": "Smoke"})
    print(f"  signup: {signup.status}", flush=True)
    logged = page.request.post(f"{base}/api/auth/login", data={"email": EMAIL, "password": PASSWORD})
    if logged.status != 200:
        raise RuntimeError(f"login failed: {logged.status} {logged.text()[:200]}")


def run_step(report: Report, n: int, fn, smoke: "Smoke | None" = None) -> None:
    try:
        fn()
    except Exception as e:  # noqa: BLE001 -- a broken step is INCONCLUSIVE, the rest still run
        report.add(n, "INCONCLUSIVE", f"step stopped on {type(e).__name__}", f"{e}\n{traceback.format_exc()[-400:]}")
        if smoke is not None:
            try:
                print(f"  [{n}] at failure: url={smoke.page.url} shot={smoke.shot(f'fail-step{n}')}", flush=True)
                print(f"  [{n}] structure: {structure(smoke.page)}", flush=True)
            except Exception as shot_error:  # noqa: BLE001
                print(f"  [{n}] could not capture the failure: {shot_error}", flush=True)


def main_run(caret_repro: int = 0) -> int:
    from playwright.sync_api import sync_playwright

    t0 = time.time()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run = SCRATCH / f"run-{stamp}"
    sandbox, tmp, shots = run / "data", run / "tmp", run / "shots"
    for d in (sandbox, tmp, shots):
        d.mkdir(parents=True, exist_ok=True)

    report = Report()
    live_before = live_fingerprint()
    print(f"[run] {run}", flush=True)
    print("[pins] deriving from conftest in a separate process", flush=True)
    pins = derive_pins(tmp)
    print(f"[pins] {len(pins)} data paths redirected into {sandbox}", flush=True)

    fx = fixtures(t0)
    state = StubState()
    for tweet, _tickers, _kind in fx["posts"]:
        state.known[tweet["id"]] = stub_post(tweet)
    linked = _tweet(LINK_OK, "harbor_watch", "Harbor Watch", "$NVDA pasted by a member: the options desk is leaning long into the print.",
                    int(t0) - 3 * 3600)
    state.known[LINK_OK] = stub_post(linked)
    stub_server, stub_port = start_stub(state)
    print(f"[stub] x lookup stub on port {stub_port}", flush=True)

    port = free_port()
    if port == 8077:
        port = free_port()
    base = f"http://127.0.0.1:{port}"
    env_on = build_env(sandbox, tmp, pins, stub_port, True, t0, run)
    print(f"[assert] DATA_DIR {env_on['DATA_DIR']} is inside the scratchpad and not the shared root", flush=True)
    assert_sandboxed(env_on)

    server = Server(env_on, port, run / "server.log")
    server2 = None
    blocked: list[str] = []
    try:
        server.start()
        server.wait()
        print(f"[server] up on {base}", flush=True)
        png_bytes = _png_bytes()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                context = browser.new_context(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce",
                                              service_workers="block")
                wire_browser(context, base, png_bytes, blocked)
                if caret_repro:
                    context.add_init_script(CARET_TRACE_JS)
                page = context.new_page()
                errors: list[str] = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                login(page, base)
                smoke = Smoke(page, base, shots, fx, report, state, run / "fetch-bars.jsonl")
                goto(page, f"{base}/journal/notebook/research/{SYMBOL}")
                try:
                    # A first-visit toast that sits over the corner of narrow screens. A member
                    # dismisses it once; leaving it up would measure the toast, not the sheet.
                    page.get_by_role("button", name="Got it").click(timeout=4000)
                except Exception:  # noqa: BLE001
                    print("  (no Meet Compass toast to dismiss)", flush=True)
                if caret_repro:
                    return 1 if smoke.caret_repro(caret_repro, run) else 0
                guard = json.loads((run / "guard-selftest.json").read_text(encoding="utf-8"))
                report.control("the server's socket guard refuses a non-loopback host", guard["socket"] == "refused", guard)
                report.control("the server's curl_cffi guard refuses a non-loopback host", guard["curl_cffi"] == "refused", guard)
                run_step(report, 1, smoke.controls, smoke)
                run_step(report, 1, smoke.step1, smoke)
                run_step(report, 2, smoke.step2, smoke)
                run_step(report, 3, smoke.step3, smoke)
                run_step(report, 4, smoke.step4, smoke)
                run_step(report, 5, smoke.step5, smoke)
                run_step(report, 6, smoke.step6, smoke)
                run_step(report, 7, smoke.step7, smoke)
                run_step(report, 8, smoke.step8, smoke)
                run_step(report, 9, smoke.step9, smoke)
                run_step(report, 10, smoke.step10, smoke)
                run_step(report, 12, lambda: smoke.step12(env_on), smoke)
                run_step(report, 13, smoke.step13, smoke)
                print(f"[pageerrors] {errors[:10]}", flush=True)

                server.stop()
                time.sleep(1)
                port2 = free_port()
                base2 = f"http://127.0.0.1:{port2}"
                env_off = build_env(sandbox, tmp, pins, stub_port, False, t0, run)
                if env_off.get("NOTEBOOK_TWEET_IMPORT_ENABLED"):
                    raise RuntimeError("the flag-off server still has the flag")
                server2 = Server(env_off, port2, run / "server-flag-off.log")
                server2.start()
                server2.wait()
                ctx2 = browser.new_context(viewport={"width": 1600, "height": 1000}, reduced_motion="reduce",
                                           service_workers="block")
                wire_browser(ctx2, base2, png_bytes, blocked)
                page2 = ctx2.new_page()
                login(page2, base2)
                smoke2 = Smoke(page2, base2, shots, fx, report, state, run / "fetch-bars.jsonl")
                smoke2.note_id = smoke.note_id
                run_step(report, 11, lambda: smoke2.step11(base2), smoke2)
            finally:
                browser.close()
    except Exception as e:  # noqa: BLE001
        print(f"[FATAL] {type(e).__name__}: {e}\n{traceback.format_exc()[-1500:]}", flush=True)
    finally:
        server.stop()
        if server2:
            server2.stop()
        stub_server.shutdown()

    live_after = live_fingerprint()
    print("\n=== RESULTS ===")
    for n, title in CHECKS.items():
        print(f"{report.status(n):<13}#{n:<3}{title}")
        for s, label, ev in report.items[n]:
            if s != "PASS":
                print(f"              {s}: {label} :: {ev[:400]}")
    print("\n=== CONTROLS ===")
    for label, ok, ev in report.controls:
        print(f"{'HELD' if ok else 'BROKEN':<8}{label} :: {ev}")
    denied = run / "outbound-denied.jsonl"
    hosts = sorted({json.loads(ln)["host"] for ln in denied.read_text().splitlines()}) if denied.exists() else []
    print(f"\n[safety] live C:\\data files unchanged: {live_before == live_after} {live_after}")
    print(f"[safety] sandbox auth.db bytes: {(sandbox / 'auth.db').stat().st_size if (sandbox / 'auth.db').exists() else None}")
    print(f"[safety] server outbound denied, hosts: {hosts}")
    print(f"[safety] browser external requests blocked: {len(blocked)} e.g. {blocked[:5]}")
    print(f"[shots] {shots}")
    summary = report.summary()
    print("\n" + summary, flush=True)
    bad = any(report.status(n) != "PASS" for n in CHECKS) or not all(ok for _, ok, _ in report.controls) or len(report.controls) < 2
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--serve", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--removal", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--port", type=int, default=0, help=argparse.SUPPRESS)
    ap.add_argument("--caret-repro", type=int, default=0, metavar="N",
                    help="skip the 12 checks; run N open/click/type rounds per note shape, with a selection trace")
    args = ap.parse_args()
    if args.serve:
        return serve(args.port)
    if args.removal:
        return removal()
    return main_run(args.caret_repro)


if __name__ == "__main__":
    sys.exit(main())
