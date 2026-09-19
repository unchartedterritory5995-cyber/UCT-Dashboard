"""A read-only, CORS-enabled sink for ONE file: the v2 Pine fixture.

⛔ It serves exactly one path and nothing else — a directory server on the repo
root would put every file on this box behind an unauthenticated port for the
length of a screenshot.
"""
import hashlib, http.server, io, pathlib

ROOT = pathlib.Path(r"C:\Users\Patrick\uct-worktrees\indicator-r0r1")
FILE = ROOT / "tests" / "fixtures" / "member" / "uncharted-volume-v2.pine"
BODY = io.open(FILE, "rb").read()
SHA = hashlib.sha256(BODY).hexdigest()


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] != "/v2.pine":
            self.send_response(404); self.end_headers(); return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Sha256", SHA)
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)

    def log_message(self, *a):
        pass


print(f"serving {FILE} ({len(BODY)} bytes, sha256 {SHA}) on :8124/v2.pine", flush=True)
http.server.HTTPServer(("127.0.0.1", 8124), H).serve_forever()
