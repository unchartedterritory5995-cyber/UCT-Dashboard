"""Probe: can a stored, deeply nested note be READ BACK through the real router?

Runs under the census pins (conftest import) so nothing reaches C:\\data.
"""
import importlib
import os
import sys
import tempfile

REPO = sys.argv[1]
sys.path.insert(0, REPO)
os.chdir(REPO)
import conftest  # noqa: F401  -- arms the pins + tripwire before any api import

tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
tmp.close()
os.environ["AUTH_DB_PATH"] = tmp.name
from api.services import auth_db  # noqa: E402
importlib.reload(auth_db)
auth_db.init_db()

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from api.middleware import auth_middleware as authmw  # noqa: E402
from api.routers import journal_two as r  # noqa: E402
from api.services.journal_two import notes as svc  # noqa: E402

fa = FastAPI()
fa.include_router(r.router)
fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u-deep", "role": "member"}
client = TestClient(fa, raise_server_exceptions=False)


def deep(n):
    node = {"type": "paragraph", "content": [{"type": "text", "text": "deepest words"}]}
    for _ in range(n):
        node = {"type": "bulletList", "content": [{"type": "listItem", "content": [node]}]}
    return {"type": "doc", "content": [node]}


for n in (10, 20, 23, 24, 30):
    c = auth_db.get_connection()
    note = svc.create_note("u-deep", {"title": f"deep {n}", "bodyJson": deep(n)}, conn=c)
    c.close()
    g = client.get(f"/api/j2/notes/{note['id']}")
    p = client.post("/api/j2/notes", json={"title": f"post {n}", "bodyJson": deep(n)})
    stored_after_post = [x for x in client.get("/api/j2/notes?limit=200").json().get("notes", [])
                         if x.get("title") == f"post {n}"]
    print(f"nested bullets {n:>2}: GET -> {g.status_code}; POST -> {p.status_code}; "
          f"POST stored a row anyway: {bool(stored_after_post)}")
os.unlink(tmp.name)
