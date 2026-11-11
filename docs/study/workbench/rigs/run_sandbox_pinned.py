"""Start the sandbox backend PINNED to the workbench's existing data directory and auth database.

tools/local_backend_sandbox.py imports the repo's conftest, which mints a FRESH temp DATA_DIR and auth.db on every
start (2026-11-05: a restart for a server fix emptied the bank, the bars and the reviewer account at once). This
wrapper lets the tool pin everything as it does, then points every pinned path that names the fresh directories at
the workbench's own (the bank, 734 tickers of bars, the reviewer account with the owner's chart settings), and
starts the server exactly as the tool would. Loopback only, like the tool.
"""
import importlib.util
import os
import sys

REPO = "C:/Users/pgosz/uct-worktrees/study-hve-overlay"
OLD_DATA = r"C:\Users\pgosz\AppData\Local\Temp\uct_tests_datadir_8_xzj23w"
OLD_AUTH_DIR = r"C:\Users\pgosz\AppData\Local\Temp\uct_tests_authdb_bqfk5zt1"
for p in (OLD_DATA, os.path.join(OLD_AUTH_DIR, "auth.db")):
    if not os.path.exists(p):
        raise SystemExit(f"pinned path missing: {p}")

sys.argv = ["local_backend_sandbox.py", "--port", "8077", "--email", "study-local@local.dev", "--log-level", "warning"]
os.chdir(REPO)
sys.path.insert(0, REPO)
spec = importlib.util.spec_from_file_location("local_backend_sandbox", os.path.join(REPO, "tools", "local_backend_sandbox.py"))
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)          # conftest pins the fresh temp paths here

fresh_data = os.environ.get("DATA_DIR", "")
fresh_auth_dir = os.path.dirname(os.environ.get("AUTH_DB_PATH", ""))
moved = 0
for k, v in list(os.environ.items()):
    nv = v
    if fresh_data and fresh_data in nv:
        nv = nv.replace(fresh_data, OLD_DATA)
    if fresh_auth_dir and fresh_auth_dir in nv:
        nv = nv.replace(fresh_auth_dir, OLD_AUTH_DIR)
    if nv != v:
        os.environ[k] = nv
        moved += 1
print(f"pinned {moved} path variable(s) from the fresh temp dirs to the workbench's own", flush=True)
sys.exit(tool.main())
