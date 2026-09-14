import json, os, time
keys = ["FLOW_FAST_DATE_SCAN", "MASSIVE_WS_ENABLED", "FLOW_BACKUP_ENABLED",
        "FLOW_GAP_AUTOFILL_ENABLED", "MASSIVE_FLATFILES_ENABLED",
        "FLOW_READS_PROXY_ENABLED", "FLOW_PARTS_ENABLED"]
out = {"env": {k: os.environ.get(k) for k in keys}, "now": time.time()}
try:
    import api.flow_db as fdb
    out["flow_db_module"] = getattr(fdb, "__file__", None)
    out["fast_scan_live_read"] = os.environ.get("FLOW_FAST_DATE_SCAN", "0") == "1"
except Exception as e:
    out["flow_db_import_error"] = repr(e)
print("PODPROBE_JSON " + json.dumps(out))
