"""Task 1 V18 probe: auth_middleware.get_user_plan(user_id) + is_paid_user(user) over real users rows, sandboxed."""
import json, sys, sqlite3
repo, data_dir = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import auth_db, auth_service
from api.middleware import auth_middleware as authmw
auth_db.init_db()
out = {}
def row(uid):
    c = sqlite3.connect(auth_db._DB_PATH); c.row_factory = sqlite3.Row
    r = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone(); c.close(); return dict(r)
free = auth_service.create_user("free@example.com", "Passw0rd!x1", "free")
pro = auth_service.create_user("pro@example.com", "Passw0rd!x1", "pro")
adm = auth_service.create_user("adm@example.com", "Passw0rd!x1", "adm")
auth_service.comp_user_access("pro@example.com", True)
c = sqlite3.connect(auth_db._DB_PATH); c.execute("UPDATE users SET role='admin' WHERE id=?", (adm["id"],)); c.commit(); c.close()
# make the "free" member older than the trial window so trial cannot hide a free plan
c = sqlite3.connect(auth_db._DB_PATH); c.execute("UPDATE users SET created_at='2025-01-01 00:00:00.000000' WHERE id=?", (free["id"],)); c.commit(); c.close()
for name, u in (("free_old", free), ("pro_comped", pro), ("admin", adm)):
    plan = authmw.get_user_plan(u["id"])
    r = row(u["id"])
    full = {**r, "plan": plan}
    out[name] = {"plan": plan, "role": r.get("role"), "is_paid_user": authmw.is_paid_user(full),
                 "columns_sample": sorted(r)[:12]}
# the shape _styled_create_allowed builds: user from get_current_user (no 'plan' key) -> {**user, 'plan': get_user_plan(id)}
out["is_paid_user_without_plan_key_free_old"] = authmw.is_paid_user(row(free["id"]))
out["PAID_PLANS"] = sorted(authmw.PAID_PLANS)
print("V18 " + json.dumps(out))
