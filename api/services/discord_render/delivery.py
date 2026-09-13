"""Discord delivery for the V2 runtime: every call returns a RESULT, never a bare bool.

⛔ The pre-V2 jobs call `edit_original` and ignore what it returns. Over 2026-08-30..09-13
that dropped 43 `10015 Unknown Webhook` and 23 double-failed `ATTACHMENT_NOT_FOUND` edits
on the floor: the job reported "ok" and the member sat on "thinking…". A result that
nobody reads is the same as no result, so here the result is a value the caller has
to unpack.

Step 2.1 ships the two calls the runtime itself needs (a text edit of @original, and a
follow-up). 2.6 adds 429/5xx policy, the size guard and pre-flight validation.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)

DISCORD_API = "https://discord.com/api/v10"
EPHEMERAL = 64
TIMEOUT_S = 10.0


@dataclass(frozen=True)
class DeliveryResult:
    ok: bool
    status: int | None = None          # HTTP status; None = no response (transport failure)
    code: int | None = None            # Discord JSON error code, when there was one
    detail: str = ""                   # short, never contains the token

    @property
    def token_dead(self) -> bool:
        """10015 Unknown Webhook / 404: the interaction token no longer accepts edits."""
        return self.code == 10015 or self.status == 404


def _result(resp) -> DeliveryResult:
    code = None
    try:
        body = resp.json()
        code = body.get("code") if isinstance(body, dict) else None
    except Exception:  # noqa: BLE001
        body = None
    if resp.is_success:
        return DeliveryResult(True, resp.status_code, None, "")
    return DeliveryResult(False, resp.status_code, code, (resp.text or "")[:200])


def edit_text(app_id: str, token: str, *, content: str, components: list | None = None,
              client=None) -> DeliveryResult:
    """PATCH @original with text (and optionally component rows). Never raises."""
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}/messages/@original"
    payload: dict = {"content": content[:2000], "allowed_mentions": {"parse": []}}
    if components is not None:
        payload["components"] = components
    return _send("patch", url, payload, client)


def followup(app_id: str, token: str, *, content: str, components: list | None = None,
             ephemeral: bool = True, client=None) -> DeliveryResult:
    """POST a follow-up message to an interaction. Used when editing @original would
    overwrite something the member is looking at (a chart under a control click)."""
    url = f"{DISCORD_API}/webhooks/{app_id}/{token}"
    payload: dict = {"content": content[:2000], "allowed_mentions": {"parse": []}}
    if ephemeral:
        payload["flags"] = EPHEMERAL
    if components is not None:
        payload["components"] = components
    return _send("post", url, payload, client)


def _send(method: str, url: str, payload: dict, client) -> DeliveryResult:
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=TIMEOUT_S)
        try:
            resp = getattr(c, method)(url, content=json.dumps(payload), headers={"Content-Type": "application/json"})
            return _result(resp)
        finally:
            if own:
                c.close()
    except Exception as e:  # noqa: BLE001 — delivery never raises into a job
        return DeliveryResult(False, None, None, type(e).__name__)
