"""Post-deploy verification for a discord-render master merge. Read-only.

  python verify_merge.py <expected_sha_prefix>

1. In-process: /proc/1/environ of the RUNNING web process (not the service config) —
   RAILWAY_GIT_COMMIT_SHA, and that DISCORD_RENDER_V2_ENABLED is absent.
2. /api/health 200 and uptime (a reset proves a new boot).
3. Interactions endpoint with a bad signature -> 401 (x3, timed).
4. GET /api/discord/render-health without the bearer -> 401.
Exit 0 only when every check passes; prints each result.
"""
import base64
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

EXPECT = sys.argv[1]
NO_POD = "--no-pod" in sys.argv          # the in-process read runs via Git Bash (MSYS_NO_PATHCONV=1) instead
BASE = "https://uctintelligence.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
ok = True

POD = r'''
import json
env = dict(kv.split("=", 1) for kv in open("/proc/1/environ", "rb").read().decode("utf-8", "replace").split("\0") if "=" in kv)
print(json.dumps({"sha": env.get("RAILWAY_GIT_COMMIT_SHA", "")[:12],
                  "v2_flag_present": "DISCORD_RENDER_V2_ENABLED" in env,
                  "alert_webhook_present": bool(env.get("DISCORD_RENDER_ALERT_WEBHOOK"))}))
'''
b64 = base64.b64encode(POD.encode()).decode()
p = subprocess.run([shutil.which("railway"), "ssh", "--service", "web", "echo", b64, "|", "base64", "-d", "|",
                    "/opt/venv/bin/python"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
line = next((l for l in p.stdout.splitlines() if l.startswith("{")), None)
pod = json.loads(line) if line else None
print("pod:", pod or f"NO ANSWER rc={p.returncode} {p.stderr.strip()[:200]}")
if not pod or not pod["sha"].startswith(EXPECT[:9]) or pod["v2_flag_present"]:
    ok = False


def req(method, path, body=None, headers=None):
    r = urllib.request.Request(BASE + path, data=body, method=method, headers={"User-Agent": UA, **(headers or {})})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", "replace"), time.perf_counter() - t
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), time.perf_counter() - t


s, b, dt = req("GET", "/api/health")
try:
    up = json.loads(b).get("uptime_seconds")
except ValueError:
    up = None
print(f"health: {s} uptime_seconds={up} ({dt:.2f}s)")
ok = ok and s == 200

for i in range(3):
    s, b, dt = req("POST", "/api/discord/interactions", body=b'{"type":1}',
                   headers={"content-type": "application/json", "X-Signature-Ed25519": "00" * 64,
                            "X-Signature-Timestamp": str(int(time.time()))})
    print(f"interactions bad-signature #{i + 1}: {s} {b[:60]!r} ({dt:.2f}s)")
    ok = ok and s == 401

s, b, dt = req("GET", "/api/discord/render-health")
print(f"render-health without bearer: {s} {b[:60]!r} ({dt:.2f}s)")
ok = ok and s == 401

print("VERIFY:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
