"""The local Study library review server.

Serves the review page on this computer only (127.0.0.1) and writes every verdict to a file on disk the moment it is
made. No internet, no account, no database. Standard library only.

    python server.py --home C:/Users/pgosz/StudyReview

Layout under --home:
    static/index.html          the page
    data/                      the questions (built by build_data.py)
    verdicts/verdicts.jsonl    ONE LINE PER VERDICT, append-only, flushed to disk each time: the record of your work
    verdicts/backups/          a timestamped copy at every start and after every 50 verdicts
    verdicts/state.json        where you stopped
    server.log                 what the server did (errors included)

The latest line for an item wins, so a changed mind is just another line and nothing is ever overwritten.
A damaged line (a power cut mid-write) is skipped and counted; every line before it still reads.
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.server
import json
import mimetypes
import os
import shutil
import socketserver
import sys
import threading
import webbrowser

LOCK = threading.Lock()
VERDICT_VALUES = ("keep", "fix", "cut", "")
MAX_BODY = 64 * 1024
BACKUP_EVERY = 50
BACKUPS_KEPT = 40


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Store:
    """The verdict file and everything around it."""

    def __init__(self, home: str):
        self.home = home
        self.dir = os.path.join(home, "verdicts")
        self.file = os.path.join(self.dir, "verdicts.jsonl")
        self.state_file = os.path.join(self.dir, "state.json")
        self.backups = os.path.join(self.dir, "backups")
        self.log_file = os.path.join(home, "server.log")
        os.makedirs(self.backups, exist_ok=True)
        self.since_backup = 0
        self.skipped = 0
        self.backup("start")

    # ── log ──
    def log(self, msg: str) -> None:
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(f"{now()} {msg}\n")
        except OSError:
            pass

    # ── read ──
    def read_all(self) -> dict:
        records: dict[str, dict] = {}
        self.skipped = 0
        if not os.path.exists(self.file):
            return records
        with open(self.file, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                    if isinstance(r, dict) and r.get("id"):
                        records[r["id"]] = r
                    else:
                        self.skipped += 1
                except ValueError:
                    self.skipped += 1
        return records

    def state(self) -> dict | None:
        try:
            with open(self.state_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    # ── write ──
    def append(self, rec: dict) -> int:
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n"
        with open(self.file, "ab") as f:
            f.write(line.encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        self.since_backup += 1
        if self.since_backup >= BACKUP_EVERY:
            self.backup("auto")
        return self.count()

    def count(self) -> int:
        n = 0
        try:
            with open(self.file, "rb") as f:
                for _ in f:
                    n += 1
        except OSError:
            pass
        return n

    def write_state(self, st: dict) -> None:
        tmp = self.state_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(st, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.state_file)

    def backup(self, why: str) -> None:
        self.since_backup = 0
        if not os.path.exists(self.file) or os.path.getsize(self.file) == 0:
            return
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = os.path.join(self.backups, f"verdicts-{stamp}-{why}.jsonl")
        try:
            shutil.copy2(self.file, dest)
            names = sorted(n for n in os.listdir(self.backups) if n.startswith("verdicts-"))
            for old in names[:-BACKUPS_KEPT]:
                os.remove(os.path.join(self.backups, old))
        except OSError as e:
            self.log(f"backup failed: {e}")


def make_handler(store: Store, static_dir: str, data_dir: str):
    class H(http.server.BaseHTTPRequestHandler):
        server_version = "StudyReview/1"

        def log_message(self, fmt, *args):  # quiet console; errors go to server.log
            pass

        def _send(self, code: int, body: bytes, ctype: str = "application/json; charset=utf-8", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj) -> None:
            self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

        def _local_only(self) -> bool:
            host = (self.headers.get("Host") or "").split(":")[0]
            return host in ("127.0.0.1", "localhost")

        def _file(self, base: str, rel: str) -> None:
            rel = rel.lstrip("/").replace("\\", "/")
            path = os.path.normpath(os.path.join(base, rel))
            if not path.startswith(os.path.normpath(base) + os.sep) and path != os.path.normpath(base):
                return self._json(403, {"error": "no"})
            if os.path.isdir(path):
                path = os.path.join(path, "index.html")
            if not os.path.isfile(path):
                return self._json(404, {"error": "not found"})
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/json", "application/javascript"):
                ctype += "; charset=utf-8"
            with open(path, "rb") as f:
                self._send(200, f.read(), ctype)

        def do_GET(self):
            if not self._local_only():
                return self._json(403, {"error": "local only"})
            p = self.path.split("?")[0]
            if p == "/api/ping":
                return self._json(200, {"ok": True, "time": now()})
            if p == "/api/verdicts":
                with LOCK:
                    recs = store.read_all()
                    return self._json(200, {"records": recs, "state": store.state(), "file": store.file,
                                            "skipped_lines": store.skipped, "lines": store.count()})
            if p.startswith("/data/"):
                return self._file(data_dir, p[len("/data/"):])
            if p in ("/", "/index.html"):
                return self._file(static_dir, "index.html")
            return self._json(404, {"error": "not found"})

        def do_POST(self):
            if not self._local_only():
                return self._json(403, {"error": "local only"})
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = 0
            if n <= 0 or n > MAX_BODY:
                return self._json(400, {"error": "bad size"})
            try:
                body = json.loads(self.rfile.read(n).decode("utf-8"))
            except ValueError:
                return self._json(400, {"error": "bad json"})
            p = self.path.split("?")[0]
            if p == "/api/verdict":
                rid = str(body.get("id") or "")[:80]
                v = body.get("v", "")
                if not rid or v not in VERDICT_VALUES:
                    return self._json(400, {"error": "bad record"})
                rec = {
                    "id": rid, "unit": str(body.get("unit") or "")[:40], "key": str(body.get("key") or "")[:20],
                    "v": v, "note": str(body.get("note") or "")[:4000], "q": str(body.get("q") or "")[:200], "at": now(),
                }
                try:
                    with LOCK:
                        count = store.append(rec)
                except OSError as e:
                    store.log(f"append failed: {e}")
                    return self._json(500, {"error": "disk"})
                return self._json(200, {"ok": True, "lines": count})
            if p == "/api/state":
                st = {"slug": str(body.get("slug") or "")[:40], "key": str(body.get("key") or "")[:20], "at": now()}
                try:
                    with LOCK:
                        store.write_state(st)
                except OSError as e:
                    store.log(f"state failed: {e}")
                    return self._json(500, {"error": "disk"})
                return self._json(200, {"ok": True})
            return self._json(404, {"error": "not found"})

    return H


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", required=True)
    ap.add_argument("--port", type=int, default=8794)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    home = os.path.abspath(a.home)
    static_dir, data_dir = os.path.join(home, "static"), os.path.join(home, "data")
    for need in (os.path.join(static_dir, "index.html"), os.path.join(data_dir, "index.json")):
        if not os.path.exists(need):
            print(f"\nMissing {need}\nRun the build first (Start Library Review.bat does this).", file=sys.stderr)
            return 2
    store = Store(home)
    store.log("server starting")
    httpd = None
    for port in range(a.port, a.port + 6):
        try:
            httpd = Server(("127.0.0.1", port), make_handler(store, static_dir, data_dir))
            break
        except OSError:
            continue
    if httpd is None:
        print("\nNo free port between %d and %d. Close other copies of the review window and try again." % (a.port, a.port + 5), file=sys.stderr)
        return 3
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    recs = store.read_all()
    print("=" * 66)
    print("  STUDY LIBRARY REVIEW IS RUNNING")
    print(f"  Open:      {url}")
    print(f"  Your work: {store.file}")
    print(f"  Already saved: {len(recs)} items" + (f"  ({store.skipped} damaged line(s) skipped)" if store.skipped else ""))
    print("  Keep this window open while you review. Close it when you are done.")
    print("=" * 66)
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    store.log("server stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
