"""The disposable sandbox identity — GENERATED per run, never written in source.

⛔ WHY THIS FILE EXISTS. The first version of the device harness carried a
literal password in two committed scripts. It was only ever a throwaway
credential for a temp-directory database that is destroyed with the sandbox —
but "it is only a test password" is exactly how real ones end up in history, and
a repository cannot un-learn a string. So there is no password in source at all:
one is generated per run, used to create the account in the fresh sandbox, and
handed to the caller in memory.

⭐ IT IS SAFE TO GENERATE because the sandbox is created empty by
`tools/e2e_sandbox_launcher.py` — a fresh temp root, its own auth database, no
relationship to any real account. Signing up IS the account's whole life cycle.

`UCT_SANDBOX_PASSWORD` overrides it for the rare case where two tools must share
one already-running sandbox; it is read from the environment and never echoed.
"""
from __future__ import annotations

import json
import os
import secrets
import urllib.error
import urllib.request

SANDBOX_EMAIL = "e2e-sandbox@local.dev"


def new_password() -> str:
    """This run's credential. Environment wins so a second tool can join a
    sandbox the first one already provisioned."""
    return os.environ.get("UCT_SANDBOX_PASSWORD") or secrets.token_urlsafe(18)


def _post(base: str, path: str, payload: dict, timeout: float = 30.0) -> int:
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def ensure_account(base: str, password: str) -> str:
    """Create (or confirm) the disposable account. Returns the email.

    ⛔ Raises rather than returning a broken state — a harness that proceeds with
    an account it could not establish produces a screen of BLOCKED rows and a
    reader who thinks the product is at fault.
    """
    _post(base, "/api/auth/signup",
          {"email": SANDBOX_EMAIL, "password": password, "display_name": "Device QA"})
    status = _post(base, "/api/auth/login", {"email": SANDBOX_EMAIL, "password": password})
    if status != 200:
        raise SystemExit(
            f"could not establish the disposable sandbox account (login HTTP {status}). "
            "If a sandbox is already running from an earlier run, export "
            "UCT_SANDBOX_PASSWORD with that run's value, or restart the sandbox."
        )
    return SANDBOX_EMAIL
