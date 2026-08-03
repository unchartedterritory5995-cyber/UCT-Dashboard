#!/usr/bin/env python3
"""Static file server with SPA fallback, for the chart parity gate.

`tools/chart_parity.py` captures `/r/chart?...` from a built `dist`. A plain
`python -m http.server` 404s that path because there is no `r/chart/index.html`
on disk -- BrowserRouter resolves it in the browser. This serves the file when it
exists and `index.html` otherwise, which is the whole difference.

WHY IT IS COMMITTED. Phase B2 ran every parity number through a copy of this file
that lived in a scratch directory and was never checked in, while
`docs/runbooks/chart-parity-gate.md` told the reader to run `<scratch>/spa_server.py`.
A gate whose harness cannot be obtained is not reproducible, and an
unreproducible gate is the failure class this whole runbook is about.

WHY NOT TWO `vite dev` SERVERS. One `node_modules` cannot back two Vite servers:
they race `node_modules/.vite`. Build twice, serve the two `dist` directories.

    cd app && npm run build && cp -r dist /tmp/parity-A
    python tools/spa_server.py /tmp/parity-A 5183

Bind on 127.0.0.1 and address it as `http://127.0.0.1:<port>` -- NOT `localhost`.
An unrelated dev server holding `[::1]:5173` once won the name resolution and the
harness measured it instead.

─── ⛔ THE HAZARD THIS FILE USED TO *CREATE* (B3 Task 11, prerequisite 1) ──────

Until 2026-08-03 line 53 read `socketserver.TCPServer.allow_reuse_address = True`
with no bind check. `SO_REUSEADDR` on Windows does not mean what it means on
Linux: it lets a SECOND socket bind an address a FIRST socket is actively
listening on. The observed consequence, reproduced by a reviewer:

    * server A is already listening on 5601 serving `/tmp/parity-A`
    * `python tools/spa_server.py /tmp/parity-B 5601` binds it too,
      **prints its success banner**, and exits no error
    * every request to 5601 keeps being answered by **A**

So the operator holds a terminal that says it is serving B, and the gate
measures A against A: two captures of the same build, 0 changed px, exit 0. That
is not hypothetical either -- this branch has already produced two
clean-but-fictional results, one of them a `0 px, 20/20, exit 0` that was
entirely wrong, and nine stale listeners were found bound in a single task.

`chart_parity.py` enforces that A and B have DIFFERENT build identities, which
catches the case above -- but two different *stale* servers pass that check and
every other machine check the tool has. The other half of the fix therefore
lives in `chart_parity.py`: it now asks each base which directory it is serving
(`/__parity_root`, below) and byte-compares what is SERVED against what is on
DISK before a single case runs.

Both halves are gated in `tests/test_chart_parity_harness.py`.

TWO CHANGES HERE, and they are independent on purpose:

  1. `allow_reuse_address = False` (plus `SO_EXCLUSIVEADDRUSE` where the platform
     has it). A bind onto a live listener now RAISES instead of succeeding.
  2. An explicit pre-bind probe that connects to the port first and refuses with
     a readable message. Belt and braces: (1) alone reports `OSError: [WinError
     10048]`, which is correct but is not an instruction, and a future edit that
     re-adds `allow_reuse_address` for some unrelated reason must not silently
     re-open the hole.
"""
import argparse
import functools
import hashlib
import http.server
import json
import os
import socket
import socketserver
import sys

#: The endpoint `chart_parity.py` uses to ask "which directory are you serving?".
#: Named here rather than spelled twice -- the harness imports this module to get
#: it, so the server and its verifier can never disagree about the string.
PARITY_ROOT_PATH = "/__parity_root"


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib naming
        if self.path.split("?", 1)[0] == PARITY_ROOT_PATH:
            return self._serve_parity_root()
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path):
            if not os.path.isdir(path) or not os.path.exists(os.path.join(path, "index.html")):
                self.path = "/index.html"
        return super().do_GET()

    def _serve_parity_root(self):
        """WHO AM I, AND WHAT AM I SERVING FROM.

        ⚠️ THE SPA FALLBACK IS WHY THIS CANNOT BE OPTIONAL-BY-ABSENCE ONLY. Any
        server built before this change answers `/__parity_root` with
        `index.html` -- a 200 carrying HTML. `chart_parity.py` therefore treats
        "200 that is not JSON" as ABSENT, which is exactly the state a stale
        listener from an older run is in, and refuses to measure it."""
        root = os.path.abspath(self.directory)
        index = os.path.join(root, "index.html")
        try:
            with open(index, "rb") as fh:
                index_sha = hashlib.sha256(fh.read()).hexdigest()
        except OSError:
            index_sha = None
        body = json.dumps({
            "root": root,
            "pid": os.getpid(),
            "index_sha256": index_sha,
            "server": "tools/spa_server.py",
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass  # a request log per asset drowns the harness output


class ExclusiveTCPServer(socketserver.TCPServer):
    """A server that REFUSES to share a port instead of silently sharing one.

    ⛔ `allow_reuse_address` is False deliberately and is not a style choice --
    see the module docstring. The class attribute is set here rather than on
    `socketserver.TCPServer` (which the old code mutated globally, reaching every
    other TCPServer in the process)."""

    allow_reuse_address = False
    # Windows' answer to "nobody may take this port from under me". Absent on
    # POSIX, where `allow_reuse_address = False` is already exclusive.
    _EXCLUSIVE = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)

    def server_bind(self):
        if self._EXCLUSIVE is not None:
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, self._EXCLUSIVE, 1)
            except OSError:
                pass  # already bound / unsupported: the bind below still fails loudly
        return super().server_bind()


def port_is_taken(host: str, port: int, timeout: float = 0.35) -> bool:
    """Is something already LISTENING there? A successful connect is the answer.

    Deliberately a connect and not a bind: a bind probe on Windows with
    `SO_REUSEADDR` set anywhere in the process is the very thing that lies."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        try:
            return s.connect_ex((host, port)) == 0
        except OSError:
            return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", help="directory to serve (a built `dist`)")
    ap.add_argument("port", type=int)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args(argv)
    if not os.path.isdir(args.root):
        raise SystemExit(f"not a directory: {args.root}")

    if port_is_taken(args.host, args.port):
        raise SystemExit(
            f"REFUSING TO START: something is already listening on "
            f"{args.host}:{args.port}.\n"
            f"  This server would have bound it anyway on Windows (SO_REUSEADDR), printed a\n"
            f"  success banner, and left every request answered by the OTHER process -- so a\n"
            f"  parity run would have measured that build while your terminal named this one.\n"
            f"  Pick a free port, or kill the listener first:\n"
            f"    powershell \"Get-NetTCPConnection -State Listen -LocalPort {args.port}\"")

    handler = functools.partial(SPAHandler, directory=args.root)
    try:
        httpd = ExclusiveTCPServer((args.host, args.port), handler)
    except OSError as e:
        raise SystemExit(
            f"REFUSING TO START: could not take exclusive ownership of "
            f"{args.host}:{args.port} ({e}).\n"
            f"  A shared port serves the OTHER process's build under this one's name.") from e
    with httpd:
        served = os.path.abspath(args.root)
        print(f"serving {served} at http://{args.host}:{args.port} (SPA fallback on)")
        print(f"identity: http://{args.host}:{args.port}{PARITY_ROOT_PATH}")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
