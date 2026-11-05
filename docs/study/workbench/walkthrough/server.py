"""Study workbench: a local page (127.0.0.1:8793) where each feature is built as its own small piece (pieces/*.html),
shown one at a time with a score + comment box. Feedback is appended to feedback.jsonl here, then ingested into
docs/study/audits/<date>/owner_verdicts.jsonl by the session. Nothing here reaches the pod."""
import json, os, sys, time, mimetypes, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
FEEDBACK = os.path.join(HERE, "feedback.jsonl")
STATIC_DIRS = ("pieces", "vendor", "fonts", "data", "parts")
SANDBOX_ENV = os.path.join(os.path.dirname(HERE), "sandbox_env.json")   # the local throwaway account; its values never reach the page or the chat
SANDBOX_API = "http://127.0.0.1:8077"

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *a):
        sys.stderr.write("%s %s\n" % (self.command, self.path))
    def _send(self, code, raw, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/signin":
            # ONE CLICK: sign the sandbox in server-side and hand the browser the cookie (same host, every port)
            q = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            back = (q.get("back") or ["/"])[0]
            try:
                env = json.load(open(SANDBOX_ENV, encoding="utf-8"))
                req = urllib.request.Request(SANDBOX_API + "/api/auth/login", data=json.dumps({"email": env["EMAIL"], "password": env["UCT_SANDBOX_PASSWORD"]}).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(req, timeout=15) as r:
                    cookies = [v for k, v in r.getheaders() if k.lower() == "set-cookie"]
            except Exception as e:
                self._send(502, ("sandbox sign-in failed: %s" % e).encode("utf-8"), "text/plain; charset=utf-8"); return
            self.send_response(302)
            for c in cookies:
                self.send_header("Set-Cookie", c.split(";")[0] + "; Path=/; SameSite=Lax")
            self.send_header("Location", back if back.startswith("http://127.0.0.1") or back.startswith("/") else "/")
            self.send_header("Content-Length", "0"); self.end_headers(); return
        if p in ("/", "/index.html"):
            self._send(200, open(os.path.join(HERE, "lab.html"), "rb").read(), "text/html; charset=utf-8"); return
        if p == "/walkthrough":
            self._send(200, open(os.path.join(HERE, "walkthrough.html"), "rb").read(), "text/html; charset=utf-8"); return
        if p in ("/pieces.json", "/steps.json"):
            self._send(200, open(os.path.join(HERE, p[1:]), "rb").read(), "application/json"); return
        if p == "/feedback":
            rows = []
            if os.path.exists(FEEDBACK):
                rows = [json.loads(l) for l in open(FEEDBACK, encoding="utf-8") if l.strip()]
            self._send(200, json.dumps(rows).encode("utf-8"), "application/json"); return
        parts = p.strip("/").split("/")
        if parts and parts[0] in STATIC_DIRS and ".." not in p:
            f = os.path.join(HERE, *parts)
            if os.path.isfile(f):
                ctype = mimetypes.guess_type(f)[0] or "application/octet-stream"
                if f.endswith(".woff2"): ctype = "font/woff2"
                if f.endswith(".html"): ctype = "text/html; charset=utf-8"
                self._send(200, open(f, "rb").read(), ctype); return
        self._send(404, b"not found", "text/plain")
    def do_POST(self):
        path, _, qs = self.path.partition("?")
        if path == "/bars":
            # a form POST from the owner's signed-in production tab carrying a bars JSON (a browser fetch to
            # 127.0.0.1 is blocked from https, a form navigation is not); saved under data/<name>.json
            import urllib.parse, re
            n = int(self.headers.get("Content-Length") or 0)
            form = urllib.parse.parse_qs(self.rfile.read(n).decode("utf-8"))
            name = re.sub(r"[^A-Za-z0-9_.-]", "", (form.get("name") or ["bars"])[0])[:60]
            body = (form.get("body") or [""])[0]
            json.loads(body)  # must be JSON
            with open(os.path.join(HERE, "data", name + ".json"), "w", encoding="utf-8") as fh:
                fh.write(body)
            self._send(200, ("saved %s (%d bytes)" % (name, len(body))).encode(), "text/plain"); return
        if path != "/feedback":
            self._send(404, b"not found", "text/plain"); return
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        body["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        with open(FEEDBACK, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(body, ensure_ascii=False) + "\n")
        self._send(200, b'{"ok":true}', "application/json")

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
    print("workbench on http://127.0.0.1:%d/" % port, flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
