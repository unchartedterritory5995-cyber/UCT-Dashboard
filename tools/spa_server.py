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
"""
import argparse
import functools
import http.server
import os
import socketserver


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib naming
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path):
            if not os.path.isdir(path) or not os.path.exists(os.path.join(path, "index.html")):
                self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *_args):
        pass  # a request log per asset drowns the harness output


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", help="directory to serve (a built `dist`)")
    ap.add_argument("port", type=int)
    args = ap.parse_args()
    if not os.path.isdir(args.root):
        raise SystemExit(f"not a directory: {args.root}")
    handler = functools.partial(SPAHandler, directory=args.root)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"serving {args.root} at http://127.0.0.1:{args.port} (SPA fallback on)")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
