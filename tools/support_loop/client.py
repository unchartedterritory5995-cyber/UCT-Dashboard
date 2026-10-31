# -*- coding: utf-8 -*-
"""The support loop's HTTP client: the ``PUSH_SECRET`` bearer, never a sign-in.

Calls ONLY ``/api/internal/indicator-support/*`` (``api/routers/indicator_support.py``,
``internal_router``): the digest, the open-report list, one report, and a status
PATCH. That door is gated by ``require_push_secret`` the same way every other
``/api/internal/*`` router is, and the local tools of this repo already reach those
routers the same way (``tools/wisdom/archive_import.py``): the secret comes from the
``PUSH_SECRET`` environment variable of the operator's shell.

⛔ The secret is read once, put in one header, and never printed, logged or put in
an exception. Every error message passes through ``redact`` first, which also
strips any echoed Authorization header.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

DEFAULT_URL = "http://127.0.0.1:8000"
URL_ENV = "UCT_SUPPORT_LOOP_URL"
PREFIX = "/api/internal/indicator-support"
_ID_RE = re.compile(r"[0-9a-f]{32}")
STATUSES = ("new", "triaged", "fixed", "wontfix")


class ClientError(RuntimeError):
    pass


def redact(text: Any, secret: str = "") -> str:
    s = str(text)
    if secret:
        s = s.replace(secret, "[redacted]")
    return re.sub(r"(?i)(authorization:?\s*bearer\s+)\S+", r"\1[redacted]", s)


class SupportLoopClient:
    def __init__(self, base_url: Optional[str] = None, secret: Optional[str] = None,
                 opener: Optional[Callable[..., Any]] = None):
        self.base = (base_url or os.environ.get(URL_ENV) or DEFAULT_URL).rstrip("/")
        self._secret = (secret if secret is not None else os.environ.get("PUSH_SECRET", "")).strip()
        if not self._secret:
            raise ClientError("PUSH_SECRET is not set in this shell (it is never read from a file "
                              "or a prompt; see docs/pine/support-loop/PHASE-B.md)")
        self._open = opener or urllib.request.urlopen

    def __repr__(self) -> str:  # never shows the secret
        return f"SupportLoopClient(base={self.base!r})"

    def _call(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + PREFIX + path, data=data, method=method,
                                     headers={"Authorization": f"Bearer {self._secret}",
                                              "Content-Type": "application/json",
                                              "User-Agent": "uct-support-loop/1"})
        try:
            with self._open(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise ClientError(redact(f"{method} {path}: HTTP {e.code}", self._secret)) from None
        except Exception as e:  # noqa: BLE001
            raise ClientError(redact(f"{method} {path}: {type(e).__name__}: {e}", self._secret)) from None

    def digest(self, refresh: bool = False) -> dict:
        return self._call("GET", "/digest" + ("?refresh=true" if refresh else ""))

    def reports(self) -> list[dict]:
        return self._call("GET", "/reports")["reports"]

    def report(self, report_id: str) -> dict:
        if not _ID_RE.fullmatch(report_id or ""):
            raise ClientError("not a report id")
        return self._call("GET", f"/reports/{report_id}")

    def set_status(self, report_id: str, status: str) -> dict:
        if not _ID_RE.fullmatch(report_id or "") or status not in STATUSES:
            raise ClientError("bad report id or status")
        return self._call("PATCH", f"/reports/{report_id}", {"status": status})
