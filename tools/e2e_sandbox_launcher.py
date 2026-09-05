"""Start `api.main:app` fail-closed against the shared `C:\\data` root, for real
browser E2E (Notebook or any other surface) against a live local server.

⛔ WHY THIS EXISTS (2026-09-05 near-miss). A Notebook E2E run set `DATA_DIR` /
`AUTH_DB_PATH` by hand and believed the server was "sandboxed." It was not:
`flow.db` / `darkpool.db` resolve through their OWN separate env vars
(`FLOW_DB_PATH`, `RAILWAY_VOLUME_MOUNT_PATH`), never set, so ordinary startup
touched the real, shared files (read-only, verified after the fact — but the
isolation itself was the thing that failed, not just this one incident).

This composes two pieces of EXISTING infrastructure rather than re-deriving a
third parallel list of env vars by hand:

  1. `tools/audit_sandbox_env.py` — walks `api/**` by AST
     (`conftest.shared_data_root_census()`) and derives a COMPLETE env: every
     `/data`-literal the census can pin, redirected under one sandbox root,
     plus the QUIET flags (background jobs that would add cost/noise/risk of
     their own). REFUSES (`SystemExit`) if the census reports any shared
     literal with no env override at all — a sandbox that silently has a hole
     in it is worse than one that refuses to start.

  2. `tools/audit_shared_root_probe.py`, `strict=True` — the runtime backstop
     for what the census CANNOT see: a call site that bypasses its own env var
     with a hardcoded default argument (`FlowDB(db_path="/data/flow.db")`,
     called with none), or any other path the AST walk missed. Strict mode
     REFUSES the access itself — raises before the real `open`/
     `sqlite3.connect`/`makedirs`/`mkdir` ever runs — rather than merely
     recording it for later review.

Neither layer alone is enough (that is the whole lesson of the near-miss):
the census answers "is there an env var for this," never "does every call
site read it." Both together give the two-sided guarantee the E2E workflow
needs: every datastore either (A) resolves inside the sandbox, or (B) the
process refuses to touch it, before the touch happens.

Usage:
    python tools/e2e_sandbox_launcher.py [--port 8091] [--root <dir>]

Prints the sandbox root, every redirected env var, and the strict-probe
status before starting uvicorn. Exits non-zero (never starts the server) if:
  - the census reports a shared literal it cannot redirect, or
  - the chosen sandbox root itself resolves inside the shared data root.
"""
from __future__ import annotations

import argparse
import os
import pathlib
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))


def _refuse_if_root_is_shared(resolved: pathlib.Path) -> None:
    """Mirrors `audit_sandbox_env.main()`'s own check — duplicated in full
    rather than imported, since that function is a CLI entrypoint (parses argv,
    prints, returns an exit code) and not itself reusable as a library call."""
    for bad in ("c:/data", "c:\\data", "/data"):
        if str(resolved).lower().rstrip("/\\").endswith(bad.rstrip("/\\")):
            raise SystemExit(
                f"REFUSING: the sandbox root resolves to the shared data root ({resolved})")


def build_environment(root: pathlib.Path, admin_email: str) -> dict:
    """The complete env this launcher will apply, or raises/exits if any
    datastore the census finds cannot be safely redirected."""
    import audit_sandbox_env as sandbox_env_tool  # tools/ is on sys.path above

    resolved = root.resolve()
    _refuse_if_root_is_shared(resolved)
    resolved.mkdir(parents=True, exist_ok=True)

    env = sandbox_env_tool.sandbox_env(resolved)  # raises SystemExit on any gap
    env["ADMIN_EMAILS"] = admin_email
    # `audit_sandbox_env` sets this to "report" for its own audit-mode use
    # case (conftest is not normally imported by a live server at all, so this
    # is inert here — kept so the two tools' env blocks stay merge-compatible
    # if something ever DOES pull conftest in transitively).
    env.setdefault("UCT_TEST_SHARED_ROOT_GUARD", "report")
    return env


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=int(os.environ.get("E2E_SANDBOX_PORT", "8091")))
    ap.add_argument("--root", default=None,
                    help="sandbox directory (default: a fresh temp dir, never reused)")
    ap.add_argument("--admin-email", default="e2e-sandbox@local.dev")
    args = ap.parse_args()

    root = pathlib.Path(args.root) if args.root else pathlib.Path(
        tempfile.mkdtemp(prefix="uct_e2e_sandbox_"))

    env = build_environment(root, args.admin_email)
    os.environ.update(env)

    # Runtime backstop — armed BEFORE `api.main` (or anything it imports) is
    # ever touched, so a bypass call site is refused on its very first attempt.
    import audit_shared_root_probe as probe
    probe.install(strict=True)

    print(f"[e2e-sandbox] root -> {root.resolve()}")
    print(f"[e2e-sandbox] strict runtime probe armed: {probe.SHARED_ROOTS}")
    print(f"[e2e-sandbox] {len(env)} env vars set (every census-derived shared-root "
          f"pin + quiet flags):")
    for k, v in sorted(env.items()):
        print(f"[e2e-sandbox]   {k} = {v}")

    import conftest  # noqa: F401  (import for its side-only-informational census;
    # NOT relied on for isolation here — build_environment() already redirected
    # every pin. Surfacing UNGUARDED_SHARED_LITERAL_SITES is purely diagnostic.)
    if conftest.UNGUARDED_SHARED_LITERAL_SITES:
        print(f"[e2e-sandbox] NOTE: {len(conftest.UNGUARDED_SHARED_LITERAL_SITES)} "
              "call site(s) bypass env entirely (hardcoded default arguments) — "
              "the strict runtime probe above is what protects these, not the env.")

    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=args.port, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
