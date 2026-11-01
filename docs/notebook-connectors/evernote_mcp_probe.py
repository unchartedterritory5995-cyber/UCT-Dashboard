"""Evernote hosted-MCP probe (E0). Throwaway; stdlib only.

  python probe.py register      # DCR only (no account needed)
  python probe.py run           # authorize in the browser (owner signs in), then probe

Writes everything to ./out/. Tokens stay in ./out/tokens.json (delete after).
Scope requested: read only.
"""
import base64, hashlib, http.server, json, os, secrets, sys, threading, time, urllib.parse, urllib.request, webbrowser

AS = "https://accounts.evernote.com"
MCP = "https://mcp.evernote.com/mcp"
RESOURCE = "https://mcp.evernote.com"
PORT = 8765
REDIRECT = f"http://127.0.0.1:{PORT}/callback"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)


def save(name, obj):
    p = os.path.join(OUT, name)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False) if not isinstance(obj, str) else f.write(obj)
    os.replace(tmp, p)


def http(method, url, body=None, headers=None, form=False):
    h = {"User-Agent": "uct-notebook-probe/0.1", "Accept": "application/json, text/event-stream"}
    h.update(headers or {})
    data = None
    if body is not None:
        if form:
            data = urllib.parse.urlencode(body).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def register():
    st, hd, b = http("POST", f"{AS}/auth/register", {
        "client_name": "UCT Notebook Sync (probe)",
        "redirect_uris": [REDIRECT],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": "read",
    })
    print("register", st, b[:600].decode("utf-8", "replace"))
    if st >= 300:
        sys.exit(1)
    client = json.loads(b)
    save("client.json", client)
    return client


def authorize(client):
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    q = {"response_type": "code", "client_id": client["client_id"], "redirect_uri": REDIRECT,
         "scope": "read", "state": state, "code_challenge": challenge,
         "code_challenge_method": "S256", "resource": RESOURCE}
    url = f"{AS}/auth/authorize?" + urllib.parse.urlencode(q)
    got = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            got.update({k: v[0] for k, v in qs.items()})
            self.send_response(200); self.send_header("Content-Type", "text/plain"); self.end_headers()
            self.wfile.write(b"UCT probe: you can close this tab.")
        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.handle_request, daemon=True).start()
    print("AUTHORIZE URL:\n" + url)
    save("authorize_url.txt", url)
    webbrowser.open(url)
    t0 = time.time()
    while not got and time.time() - t0 < 600:
        time.sleep(0.5)
    if got.get("state") != state or "code" not in got:
        print("authorize failed", got); sys.exit(1)
    st, hd, b = http("POST", f"{AS}/auth/token", {
        "grant_type": "authorization_code", "code": got["code"], "redirect_uri": REDIRECT,
        "client_id": client["client_id"], "code_verifier": verifier, "resource": RESOURCE}, form=True)
    tok = json.loads(b)
    print("token", st, {k: (v if k not in ("access_token", "refresh_token", "id_token") else f"<{len(str(v))} chars>") for k, v in tok.items()})
    save("tokens.json", tok)
    save("token_shape.json", {k: (type(v).__name__ if k in ("access_token", "refresh_token", "id_token") else v) for k, v in tok.items()})
    return tok


class Mcp:
    def __init__(self, token):
        self.token, self.sid, self.n = token, None, 0
        self.log = []

    def rpc(self, method, params=None, notify=False):
        self.n += 1
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if not notify:
            msg["id"] = self.n
        h = {"Authorization": f"Bearer {self.token}", "MCP-Protocol-Version": "2025-06-18"}
        if self.sid:
            h["Mcp-Session-Id"] = self.sid
        t0 = time.time()
        st, hd, b = http("POST", MCP, msg, h)
        dt = round(time.time() - t0, 2)
        self.sid = hd.get("Mcp-Session-Id") or hd.get("mcp-session-id") or self.sid
        text = b.decode("utf-8", "replace")
        res = None
        if "text/event-stream" in (hd.get("Content-Type") or hd.get("content-type") or ""):
            for line in text.splitlines():
                if line.startswith("data:"):
                    try:
                        res = json.loads(line[5:].strip())
                    except Exception:
                        pass
        elif text.strip():
            try:
                res = json.loads(text)
            except Exception:
                res = {"raw": text[:2000]}
        self.log.append({"method": method, "status": st, "secs": dt,
                         "ratelimit": {k: v for k, v in hd.items() if "rate" in k.lower() or k.lower() == "retry-after"}})
        return st, res

    def call(self, name, args):
        return self.rpc("tools/call", {"name": name, "arguments": args})


def probe(tok, client):
    m = Mcp(tok["access_token"])
    st, init = m.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                    "clientInfo": {"name": "uct-notebook-probe", "version": "0.1"}})
    save("initialize.json", {"status": st, "result": init, "session": bool(m.sid)})
    m.rpc("notifications/initialized", notify=True)
    st, tools = m.rpc("tools/list", {})
    save("tools_list.json", tools)
    names = [t["name"] for t in ((tools or {}).get("result") or {}).get("tools", [])]
    print("tools:", names)
    results = {}

    def tryc(label, name, args):
        if name not in names:
            results[label] = "tool not present"; return None
        st, r = m.call(name, args)
        results[label] = {"status": st, "args": args, "result": r}
        return r

    tryc("search_all", "search_notes", {"query": "*"})
    tryc("search_empty", "search_notes", {"query": ""})
    tryc("search_updated", "search_notes", {"query": "updated:20200101"})
    tryc("notebooks", "search_notebooks", {})
    save("probe_results.json", results)
    save("call_log.json", m.log)
    # refresh token check
    if tok.get("refresh_token"):
        st, hd, b = http("POST", f"{AS}/auth/token", {"grant_type": "refresh_token",
            "refresh_token": tok["refresh_token"], "client_id": client["client_id"], "resource": RESOURCE}, form=True)
        r = json.loads(b or b"{}")
        save("refresh_check.json", {"status": st, "keys": sorted(r.keys()), "expires_in": r.get("expires_in"),
                                    "rotated_refresh": bool(r.get("refresh_token")) and r.get("refresh_token") != tok["refresh_token"]})
        if r.get("access_token"):
            tok.update(r); save("tokens.json", tok)
    print("done; outputs in", OUT)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "register":
        register()
    elif cmd == "run":
        client = json.load(open(os.path.join(OUT, "client.json"))) if os.path.exists(os.path.join(OUT, "client.json")) else register()
        tok = authorize(client)
        probe(tok, client)
