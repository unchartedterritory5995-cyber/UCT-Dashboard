"""Firm-playbook setup-tagging pass for Desk videos.

Runs off the STORED transcript (no YouTube, no proxy): for each enriched video
with no setup tags, fetch its stored cues, run the focused `generate_setups` call
(validated against the exact Setup-Library taxonomy → no mislabeling), and store
the tags. Idempotent.

    python scripts/backfill_setups.py            # all
    python scripts/backfill_setups.py 3          # first 3 (smoke test)
    python scripts/backfill_setups.py --base http://localhost:8000
"""
from __future__ import annotations

import os
import sys
import time

import requests

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
for _envpath in (os.path.join(_ROOT, ".env"), r"C:\Users\Patrick\uct-dashboard\.env"):
    if os.path.exists(_envpath):
        for _line in open(_envpath, encoding="utf-8"):
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
        break

from api.services.desk_session_insights import generate_setups  # noqa: E402

BASE = "https://uctintelligence.com"
if "--base" in sys.argv:
    BASE = sys.argv[sys.argv.index("--base") + 1]
LIMIT = next((int(a) for a in sys.argv[1:] if a.isdigit()), None)
H = {
    "Authorization": f"Bearer {os.environ.get('PUSH_SECRET', '')}",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) uct-setups",
}


def main():
    r = requests.get(f"{BASE}/api/education/insights-backfill/needs-setups?limit=2000",
                     headers=H, timeout=30)
    r.raise_for_status()
    vids = r.json()["videos"]
    if LIMIT:
        vids = vids[:LIMIT]
    print(f"{len(vids)} videos to tag with setups\n")

    tagged = none_found = failed = 0
    for i, v in enumerate(vids, 1):
        vid, title = v["id"], (v["title"] or "")
        print(f"[{i}/{len(vids)}] {vid} — {title[:60]}")
        try:
            cr = requests.get(f"{BASE}/api/education/videos/{vid}/transcript-cues", headers=H, timeout=30)
            cues = cr.json().get("cues", []) if cr.ok else []
        except Exception as e:
            print(f"    cues fetch failed ({type(e).__name__})"); failed += 1; continue
        if not cues:
            print("    no transcript cues — skip"); none_found += 1; continue
        try:
            setups = generate_setups(title, cues)
        except Exception as e:
            print(f"    generate failed ({type(e).__name__}: {str(e)[:100]})"); failed += 1; continue
        try:
            pr = requests.post(f"{BASE}/api/education/videos/{vid}/insights-store",
                               json={"setups": setups}, headers=H, timeout=30)
        except Exception as e:
            print(f"    store failed ({type(e).__name__})"); failed += 1; continue
        if not pr.ok:
            print(f"    store HTTP {pr.status_code}: {pr.text[:120]}"); failed += 1; continue
        if setups:
            print(f"    ✓ {len(setups)} setups ({', '.join(s['setup'] for s in setups)})")
            tagged += 1
        else:
            print("    (no playbook setups in this video)")
            none_found += 1
        time.sleep(0.8)

    print(f"\nDONE — {tagged} tagged · {none_found} none · {failed} failed")


if __name__ == "__main__":
    main()
