"""Task 1 V6 probe: (a) a private alert written by one process is served by ANOTHER process through
alert_durability (the server's get_alerts), and (b) how often `alerts.add_alert`'s id scheme
(f"{type}_{int(time.time()*1000)}", a GLOBAL primary key in user_alerts) drops a second member's durable copy
when several members get the same alert type inside one millisecond.

    python t2b_v6_probe.py <repo> <sandbox_data_dir> write|read|collide

Sandboxed by the census pins first (hub_sandbox_boot.apply_sandbox_env); no key is read; no network.
"""
import json
import sys
import time

repo, data_dir, mode = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b  # noqa: E402

b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import alert_durability, alerts  # noqa: E402

alert_durability.init_schema()
if mode == "write":
    a = alerts.add_alert("notebook_earnings_followup", "Follow-up probe", "written by the child",
                         data={"research_url": "/journal/notebook?followup=ORCL&reportDate=2026-10-14"},
                         user_id="probe-user-1")
    print("V6_WRITE " + json.dumps({"id": a["id"], "user_id": a["user_id"], "pid_cache_has": bool(alerts.cache.get(alerts._user_key("probe-user-1")))}))
elif mode == "read":
    # A brand-new process: the in-memory cache is empty, so ONLY the durable store can answer.
    from api.routers import alerts as alerts_router  # the module GET /api/alerts is declared in
    rows = alerts.get_alerts(50, user_id="probe-user-1")
    other = alerts.get_alerts(50, user_id="probe-user-2")
    print("V6_READ " + json.dumps({"router_fn": alerts_router.list_alerts.__module__ + "." + alerts_router.list_alerts.__name__,
                                   "service_fn": alerts.get_alerts.__module__ + "." + alerts.get_alerts.__name__,
                                   "rows_for_user1": [{"id": r["id"], "type": r["type"], "data": r["data"]} for r in rows],
                                   "rows_for_user2": len(other)}))
elif mode == "collide":
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 200
    t0 = time.monotonic()
    ids = []
    for i in range(n):
        a = alerts.add_alert("notebook_earnings_followup", "t", "m", user_id=f"collide-user-{i}")
        ids.append(a["id"])
    secs = time.monotonic() - t0
    durable = sum(len(alert_durability.list_durable_alerts(f"collide-user-{i}")) for i in range(n))
    ephemeral = sum(len(alerts.cache.get(alerts._user_key(f"collide-user-{i}")) or []) for i in range(n))
    print("V6_COLLIDE " + json.dumps({"members": n, "distinct_ids": len(set(ids)), "durable_rows": durable,
                                      "ephemeral_rows": ephemeral, "secs": round(secs, 3),
                                      "ms_per_call": round(1000 * secs / n, 2)}))
