"""Run the REAL bars-api (api.bars_api_main, real uvicorn, real lanes, real SQLite) for the 500-member replay.

Safety, all enforced in this process before the app is imported:
  * the store is the box's bars.db opened READ-ONLY + immutable (sqlite URI), never written;
  * every outbound socket that is not loopback is refused (no vendor, no R2, no production);
  * vendor/R2 credentials are blanked; proxies point at a dead loopback port.
Usage: python launch_bars_api.py <port> <src_dir> [<workers>]
"""
import os, sys, socket, sqlite3

PORT = int(sys.argv[1]); SRC = sys.argv[2]; WORKERS = int(sys.argv[3]) if len(sys.argv) > 3 else 1
STORE = os.environ.get("REPLAY_STORE", "C:/data/bars.db")
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_%d" % PORT)
os.makedirs(DATA, exist_ok=True)
open(os.path.join(DATA, "bars.db"), "ab").close()          # placeholder: exists() is true; never opened as itself

for k in list(os.environ):
    if any(t in k.upper() for t in ("MASSIVE", "POLYGON", "R2_", "AWS_", "S3_", "FMP", "FINNHUB", "OPENAI",
                                       "ANTHROPIC", "PUSH_SECRET", "DATABASE_URL", "DATA_SYNC")):
        os.environ.pop(k)
os.environ.update({"DATA_DIR": DATA, "BARS_API_ENABLED": "1", "PORT": str(PORT),
                   "HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9",
                   "NO_PROXY": "127.0.0.1,localhost", "BARS_OFFGRID_SWEEP": "0",
                   "BARS_API_WORKERS": str(WORKERS), "TMPDIR": os.path.join(DATA, "tmp")})

_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex
def _loopback(addr):
    try:
        host = addr[0] if isinstance(addr, tuple) else addr
        return host in ("127.0.0.1", "::1", "localhost") or str(host).startswith("127.")
    except Exception:
        return False
def _guard_connect(self, addr):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(addr):
        raise ConnectionRefusedError("replay sandbox: outbound %r refused" % (addr,))
    return _real_connect(self, addr)
def _guard_connect_ex(self, addr):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _loopback(addr):
        return 111
    return _real_connect_ex(self, addr)
socket.socket.connect = _guard_connect
socket.socket.connect_ex = _guard_connect_ex
_real_gai = socket.getaddrinfo
def _gai(host, *a, **k):
    if host not in (None, "127.0.0.1", "::1", "localhost", "0.0.0.0") and not str(host).startswith("127."):
        raise socket.gaierror("replay sandbox: DNS for %r refused" % (host,))
    return _real_gai(host, *a, **k)
socket.getaddrinfo = _gai

_real_sqlite_connect = sqlite3.connect
_PLACE = os.path.normcase(os.path.abspath(os.path.join(DATA, "bars.db")))
_RO = "file:%s?mode=ro&immutable=1" % STORE.replace("\\", "/")
def _sq(database, *a, **k):
    d = str(database)
    path = d[5:].split("?", 1)[0] if d.startswith("file:") else d
    if path and path != ":memory:" and os.path.normcase(os.path.abspath(path)) == _PLACE:
        k["uri"] = True
        return _real_sqlite_connect(_RO, *a, **k)
    return _real_sqlite_connect(database, *a, **k)
sqlite3.connect = _sq

sys.path.insert(0, SRC)
os.chdir(SRC)
from api import bars_api_main as bam
# Production steady state: the live store (5m/D, BARS_LIVE_COVERAGE_ENABLED) and the nightly keep every STORED series
# current, so a member read never waits on a provider. This box's store is two days old and has no vendor, so the
# freshness rule is pinned to "stored = current" (a series with nothing stored still takes the real miss path).
from api.services import bars_fetch as _bf
_bf._needs_fresh = lambda last_ts, tf, ticker=None: last_ts is None
# No vendor here: the yfinance fallback (curl_cffi, which the socket guard cannot see) fails at once instead of
# waiting out its 3.5-8 s pool timeout, so a miss costs what a refused provider costs, not a sandbox artefact.
from api.services import yfinance_pool as _yp
def _no_vendor(*a, **k):
    raise TimeoutError("replay sandbox: no vendor")
_yp.fetch_history = _no_vendor
_yp.run_in_pool = _no_vendor
if __name__ != "__main__" or os.environ.get("REPLAY_NO_SERVE") == "1":
    pass        # a multiprocessing child (spawn re-imports this file as __mp_main__) or a profiling import
elif WORKERS > 1 and hasattr(bam, "serve_multi"):
    bam.serve_multi(port=PORT, workers=WORKERS, preload=__file__)
else:
    bam.main()
