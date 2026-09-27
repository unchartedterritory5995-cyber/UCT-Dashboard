"""Owner-authorized ("1. Yes", 2026-09-25) removal of three orphan edu_videos rows whose
YouTube videos no longer exist (ids 324, 353, 354), through the app's own admin route
DELETE /api/education/videos/{id} -- never raw SQL. Refuses to run unless the pre-delete
backup exists beside it. Reads back the library afterwards and asserts the set difference
is exactly the three ids. Credentials from SMOKE_EMAIL/SMOKE_PASSWORD, never printed."""
import json, os, sys, urllib.request, http.cookiejar

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) desk-rows-delete"
IDS = [324, 353, 354]
# The backup lives BESIDE this script (the scratchpad copy is desk_rows_backup.json; the
# committed evidence copy is rows-before-delete.json) -- resolve from the script's own
# directory, never the caller's cwd, or a run from the repo root refuses for no reason.
_HERE = os.path.dirname(os.path.abspath(__file__))
BACKUP = next((p for p in (os.path.join(_HERE, "desk_rows_backup.json"),
                           os.path.join(_HERE, "rows-before-delete.json")) if os.path.exists(p)), None)
if not BACKUP:
    print(f"REFUSED: no pre-delete backup beside {_HERE}"); sys.exit(3)
bk = json.load(open(BACKUP, encoding="utf-8"))
assert sorted(r["id"] for r in bk["rows"]) == IDS, "backup does not hold exactly the three rows"
assert not bk["path_references"], "a path still references one of the rows"
email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw):
    print("INCONCLUSIVE: credentials not in env"); sys.exit(2)
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
r = op.open(urllib.request.Request(f"{BASE}/api/auth/login", data=json.dumps({"email": email, "password": pw}).encode(),
                                   headers={"Content-Type": "application/json", "User-Agent": UA}, method="POST"), timeout=30)
print("login", r.status)
def ids_now():
    body = json.loads(op.open(urllib.request.Request(f"{BASE}/api/education/videos", headers={"User-Agent": UA}), timeout=60).read())
    out = set()
    def walk(o):
        if isinstance(o, dict):
            if "youtube_id" in o and "id" in o: out.add(o["id"])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(body); return out
before = ids_now()
print("library before:", len(before), "| targets present:", sorted(i for i in IDS if i in before))
for i in IDS:
    try:
        rr = op.open(urllib.request.Request(f"{BASE}/api/education/videos/{i}", headers={"User-Agent": UA}, method="DELETE"), timeout=60)
        print(f"DELETE {i}: {rr.status} {rr.read().decode()[:60]}")
    except urllib.error.HTTPError as e:
        print(f"DELETE {i}: {e.code} {e.read()[:120]}")
after = ids_now()
removed, added = sorted(before - after), sorted(after - before)
print("library after:", len(after), "| removed:", removed, "| added:", added)
print("VERDICT:", "OK exactly the three" if removed == IDS and not added else "MISMATCH -- investigate")
