"""Refuse to start the full application inside the front-door service.

The front door (`api/front_app.py`) runs the SAME image as `web`, with its own start
command (`front/service.json`). If that start command is ever not applied (a wrong config
path, a setting that config-as-code overrides, a service created by hand) the image's
default command starts `api.main:app`: a SECOND copy of the whole application, with its
schedulers and jobs, on the production project.

That has happened. `docs/breadth/INC-1-second-app-instance.md` (2026-09-16): a throwaway
service was given a start command meant to make the app impossible to run, config-as-code
overrode it, and the deployment came up SUCCESS as a full copy of the app. What contained
it was that the service carried no variables, which is luck, not a guard.

So the capability is removed. `FRONT_UPSTREAM` exists only on the front-door service (it
is how that service finds `web`, and `api/front_app.py` refuses to start without it).
`api/main.py` calls this before it does anything else, and a process that has that variable
and is importing the full application stops with an error. The deployment FAILS, loudly,
instead of succeeding as the wrong program.
"""
from __future__ import annotations

import os

MESSAGE = (
    "FRONT_UPSTREAM is set, so this service is the front door: it must start "
    "`uvicorn api.front_app:app` (front/service.json), never the full application "
    "`api.main:app`. Refusing to start a second copy of the application. If this really is "
    "the web service, FRONT_UPSTREAM must not be set on it."
)


def is_front_door(environ=None) -> bool:
    environ = os.environ if environ is None else environ
    return bool((environ.get("FRONT_UPSTREAM") or "").strip())


def refuse_full_app_on_front_door(environ=None) -> None:
    """Raise when the full application is being started where only the front door may run."""
    if is_front_door(environ):
        raise RuntimeError(MESSAGE)
