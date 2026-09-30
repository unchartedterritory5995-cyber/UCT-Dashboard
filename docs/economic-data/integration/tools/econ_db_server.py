"""Scratch wrapper: app/src/econHarness/econ_local_server.py, but ECON_SERVING_SOURCE=db over the COPY.
Same router-only app, same push-secret door, same credential blanking. LOCAL ONLY."""
import os, sys
sys.path.insert(0, r"C:\w\econint")
from importlib import util
spec = util.spec_from_file_location("els", r"C:\w\econint\app\src\econHarness\econ_local_server.py")
els = util.module_from_spec(spec); spec.loader.exec_module(els)
secret = os.environ["ECON_HARNESS_PUSH_SECRET"]
assert len(secret) >= 16
for k in els._CREDS:
    os.environ.pop(k, None)
os.environ.update(PUSH_SECRET=secret, ECON_ENABLED="1", ECON_SERVING_SOURCE="db", ECON_PUBLISH_R2="0",
                  ECON_DB_PATH=r"C:\w\econint-data\econ.db", ECON_CACHE_TTL="5")
os.environ.pop("ECON_ARTIFACT_DIR", None)
import uvicorn
from fastapi import FastAPI
from api.routers import econ
import api.services.econ.serving as sv
assert sv.mode() == "db", sv.mode()
print("serving mode", sv.mode(), "db", os.environ["ECON_DB_PATH"], "code", sv.__file__, flush=True)
app = FastAPI(title="econ-harness (local, router only, db)")
app.include_router(econ.router)
uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[1]), log_level="warning")
