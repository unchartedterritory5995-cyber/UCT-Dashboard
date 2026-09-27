"""Dump one S7 type's full dark report JSON to a file (all predicates, nothing truncated),
with member user ids masked. Read-only, admin smoke account; credentials from env, never printed."""
import json, os, re, sys, urllib.request, http.cookiejar

BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) dark-dump"
kind, out = sys.argv[1], sys.argv[2]
email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw):
    print("INCONCLUSIVE: credentials not in env"); sys.exit(2)
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
op.open(urllib.request.Request(f"{BASE}/api/auth/login", data=json.dumps({"email": email, "password": pw}).encode(),
                               headers={"Content-Type": "application/json", "User-Agent": UA}, method="POST"), timeout=30)
body = op.open(urllib.request.Request(f"{BASE}/api/admin/alert-taxonomy/dark-report/{kind}", headers={"User-Agent": UA}), timeout=90).read().decode("utf-8")
masked = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<uid>", body)
open(out, "w", encoding="utf-8").write(masked)
d = json.loads(masked)
print(kind, "predicate_count", d.get("predicate_count"), "->", out)
for r in d.get("predicates", []):
    print(f"  ready={r.get('verdict_ready')!s:5} sessions={len(r.get('sessions_covered', [])):2} agreed={r.get('agreed')} new_only={r.get('new_only')} legacy_only={r.get('legacy_only')} nc={r.get('not_comparable')} kinds={r.get('level_kinds')} trend={r.get('is_trendline')} | {r.get('predicate_id','')[:60]}")
