# READ-ONLY: print the owner's saved chart look (the same blob /api/study/house-chart serves), gzip+base64.
import sys, json, zlib, base64
sys.path.insert(0, "/app")
from api.services.house_chart import owner_chart_settings
d = owner_chart_settings()
blob = base64.b64encode(zlib.compress(json.dumps(d, separators=(",", ":")).encode(), 9)).decode()
sys.stdout.write("BEGIN_HOUSE" + chr(10) + blob + chr(10) + "END_HOUSE" + chr(10))
sys.stderr.write("reason=%s keys=%s" % (d.get("reason"), list((d.get("chart_settings") or {}).keys())[:20]) + chr(10))
