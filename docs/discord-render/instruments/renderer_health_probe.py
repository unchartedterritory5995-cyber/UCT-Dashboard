import json
import urllib.request

try:
    with urllib.request.urlopen("http://chart-renderer.railway.internal:8080/health", timeout=15) as r:
        body = json.loads(r.read().decode("utf-8", "replace"))
    keys = ("ok", "ready", "browser", "browser_connected", "pool_enabled", "renders_total", "renders_since_recycle",
            "recycles", "active", "queued", "p95_render_ms", "rss_mb", "timeouts", "failures", "launch_error")
    print("RENDERER " + json.dumps({"status": r.status, "keys_present": sorted(body),
                                    **{k: body.get(k) for k in keys if k in body}}))
except Exception as e:  # noqa: BLE001
    print("RENDERER " + json.dumps({"error": type(e).__name__, "detail": str(e)[:160]}))
