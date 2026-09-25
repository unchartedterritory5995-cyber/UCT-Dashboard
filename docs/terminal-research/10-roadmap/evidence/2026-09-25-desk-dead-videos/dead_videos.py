"""Name the three edu_videos rows whose YouTube ids 404 on every thumbnail variant
and on oEmbed (2026-09-25 /desk console finding). Reads SMOKE_EMAIL/SMOKE_PASSWORD
from the environment and never prints them. Prints id/title/category/created only."""
import json, os, sys, datetime as dt, urllib.request

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dead-video-census"
DEAD = ["vslaRnO9G3E", "hmGZSV_axHo", "znjo804B_0k"]

email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw):
    print("INCONCLUSIVE: SMOKE_EMAIL/SMOKE_PASSWORD not in env"); sys.exit(2)

import http.cookiejar
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
req = urllib.request.Request(f"{BASE}/api/auth/login", data=json.dumps({"email": email, "password": pw}).encode(),
                             headers={"Content-Type": "application/json", "User-Agent": UA}, method="POST")
with opener.open(req, timeout=30) as r:
    if r.status != 200:
        print("INCONCLUSIVE: login", r.status); sys.exit(2)
req = urllib.request.Request(f"{BASE}/api/education/videos", headers={"User-Agent": UA})
with opener.open(req, timeout=30) as r:
    body = json.loads(r.read().decode("utf-8"))
# The endpoint returns videos GROUPED by category (svc.grouped_videos_payload); walk
# the whole payload and collect every dict carrying a youtube_id, whatever the nesting.
vids = []
def walk(o):
    if isinstance(o, dict):
        if "youtube_id" in o: vids.append(o)
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(body)
print(f"library rows: {len(vids)}")
hit = 0
for v in vids:
    if v.get("youtube_id") in DEAD:
        hit += 1
        ts = v.get("created_at")
        when = dt.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") if isinstance(ts, (int, float)) else ts
        print(f"  id={v.get('id')} yt={v.get('youtube_id')} cat={v.get('category')!r} created={when} title={v.get('title')!r}")
print(f"matched {hit}/{len(DEAD)}")
