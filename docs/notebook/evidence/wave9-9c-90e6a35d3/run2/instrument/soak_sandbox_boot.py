"""SANDBOX-ONLY launcher for wave 9 lane 9C's browser check. Copied into the root of a
`git archive` export of the lane tip and run from there, from PowerShell:

    python soak_sandbox_boot.py --data-dir 'C:\\data-9c' --port 8206

It is `scripts/hub_sandbox_boot.py`, UNCHANGED (its census pins, tripwire, snapshot
checkpoints and identity nonce all run exactly as they always do), plus ONE thing:
the router this lane adds, `api/routers/notebook_soak.py`, mounted AHEAD of the SPA
catch-all -- which is where the controller's `api/main.py` mount will put it. The lane
does not own `api/main.py`, so the sandbox mounts it here instead of editing that file.

⛔ ORDER IS LOAD-BEARING: nothing under `api.*` is imported until `hub_sandbox_boot.main()`
has applied the census pins. The mount happens inside the patched `uvicorn.run`, i.e.
after `from api.main import app` has run under the pins.
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import uvicorn  # noqa: E402

_real_run = uvicorn.run


def _run(app, *a, **kw):
    import api.main as m  # already imported by hub_sandbox_boot.main(), under the pins
    from api.routers import notebook_soak
    before = len(m.app.router.routes)
    m.app.include_router(notebook_soak.router)
    added = m.app.router.routes[before:]
    del m.app.router.routes[before:]
    m.app.router.routes[0:0] = added
    paths = [getattr(r, "path", "?") for r in added]
    print(f"  [9C] mounted {paths} from api/routers/notebook_soak.py AHEAD of the SPA catch-all", flush=True)
    return _real_run(app, *a, **kw)


uvicorn.run = _run

import hub_sandbox_boot  # noqa: E402

if __name__ == "__main__":
    hub_sandbox_boot.main()
