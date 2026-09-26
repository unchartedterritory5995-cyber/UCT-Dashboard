"""Before the owner-authorized delete of three orphan edu_videos rows: capture each row
IN FULL from the app's own grouped payload (the by-youtube route returns only id/title),
and scan every education path for a reference to those ids. Read-only. Credentials come
from SMOKE_EMAIL/SMOKE_PASSWORD in the environment and are never printed."""
import json, os, sys, urllib.request, http.cookiejar, datetime as dt

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) desk-rows-backup"
IDS = {324, 353, 354}
OUT = sys.argv[1] if len(sys.argv) > 1 else "desk_rows_backup.json"
email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw):
    print("INCONCLUSIVE: credentials not in env"); sys.exit(2)
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
r = op.open(urllib.request.Request(f"{BASE}/api/auth/login", data=json.dumps({"email": email, "password": pw}).encode(),
                                   headers={"Content-Type": "application/json", "User-Agent": UA}, method="POST"), timeout=30)
print("login", r.status)
def get(path):
    return json.loads(op.open(urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": UA}), timeout=60).read().decode("utf-8"))
rows = []
def walk(o):
    if isinstance(o, dict):
        if "youtube_id" in o and o.get("id") in IDS: rows.append(o)
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(get("/api/education/videos"))
print("rows captured:", sorted(r["id"] for r in rows))
paths = get("/api/education/paths")
blob = json.dumps(paths)
refs = {i for i in IDS if f'"video_id": {i}' in blob or f'"id": {i},' in blob and '"youtube_id"' not in blob}
# a stricter, structural scan: any dict inside the paths payload whose video_id / id equals one of ours
hits = []
def scan(o, trail=""):
    if isinstance(o, dict):
        for k in ("video_id", "edu_video_id"):
            if o.get(k) in IDS: hits.append((trail, k, o.get(k)))
        for k, v in o.items(): scan(v, f"{trail}/{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o): scan(v, f"{trail}[{i}]")
scan(paths)
print("path references to the three ids:", hits if hits else "none")
json.dump({"captured_at": dt.datetime.now(dt.timezone.utc).isoformat(), "rows": rows,
           "path_references": hits}, open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("wrote", OUT)
