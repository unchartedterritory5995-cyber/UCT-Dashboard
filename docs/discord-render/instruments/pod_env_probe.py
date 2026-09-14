import json
raw = open("/proc/1/environ", "rb").read().decode("utf-8", "replace")
env = dict(kv.split("=", 1) for kv in raw.split(chr(0)) if "=" in kv)
print("PROBE " + json.dumps({
    "sha": env.get("RAILWAY_GIT_COMMIT_SHA", "")[:12],
    "v2_flag_present": "DISCORD_RENDER_V2_ENABLED" in env,
    "alert_webhook_present": bool(env.get("DISCORD_RENDER_ALERT_WEBHOOK")),
    "env_keys": len(env),
}))
