"""Read the S7 scan-membership-change DARK report as the smoke account (admin).
Read-only. SMOKE_EMAIL/SMOKE_PASSWORD come from the environment and are never printed."""
import json, os, sys, urllib.request, http.cookiejar

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dark-report-probe"
email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw):
    print("INCONCLUSIVE: credentials not in env"); sys.exit(2)
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
r = op.open(urllib.request.Request(f"{BASE}/api/auth/login", data=json.dumps({"email": email, "password": pw}).encode(),
                                   headers={"Content-Type": "application/json", "User-Agent": UA}, method="POST"), timeout=30)
print("login", r.status)
kind = sys.argv[1] if len(sys.argv) > 1 else "scan-membership-change"
try:
    path = "/api/admin/alert-taxonomy/dark-report" + ("" if kind == "all" else f"/{kind}")
    rr = op.open(urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": UA}), timeout=60)
    body = json.loads(rr.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print(kind, e.code, e.read()[:200]); sys.exit(1)
print("status", rr.status)
MAXLEN = int(sys.argv[2]) if len(sys.argv) > 2 else 110
def show(o, depth=0, maxlen=None):
    maxlen = maxlen or MAXLEN
    pad = "  " * depth
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, (dict, list)) and depth < 2:
                print(f"{pad}{k}:"); show(v, depth + 1)
            else:
                s = json.dumps(v, default=str); print(f"{pad}{k}: {s[:maxlen]}{'...' if len(s) > maxlen else ''}")
    elif isinstance(o, list):
        print(f"{pad}[{len(o)} items]")
        for it in o[:6]:
            s = json.dumps(it, default=str); print(f"{pad}- {s[:maxlen]}{'...' if len(s) > maxlen else ''}")
show(body)
