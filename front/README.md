# The front door (`web-front`)

A stateless service that serves the built frontend and passes everything else to `web`.
Code: `api/front_app.py`. Railway config: `front/service.json`. It runs the SAME image as
`web` (`Dockerfile.web`); only the start command differs.

Why: `web` has its data disk attached, so every deploy of `web` is 40 to 75 seconds of
502 for members, and a frontend-only change restarts it just the same. A service with no
disk and two copies is replaced with no gap.

## What it serves and what it passes on

- Serves itself: `/assets`, `/fonts`, the files in `front_app.ROOT_FILES`, the
  live-trading-room pages, `/build.json`, and the app shell for every other GET or HEAD.
- Passes to `web`, byte for byte, never retried, never held: `/api/*`, the paths in
  `front_app.PROXY_PATHS`, and every method other than GET and HEAD.
- It never serves "any file that exists in the build". The authority is `web`'s route
  table. `tests/test_front_app_parity.py` fails when a route outside `/api` is neither
  served here nor passed through.

## Variables on the service

| Name | Value |
|---|---|
| `FRONT_UPSTREAM` | `web.railway.internal:<PORT of web>`. Required; the app refuses to start without it. |
| every `VITE_*` | a Railway REFERENCE to `web`'s value (`${{web.VITE_X}}`), never a typed copy. The image builds the frontend, and these are build values. |
| `ASSETS_NO_TRANSFORM_ENABLED`, `PRECOMPRESSED_ASSETS_ENABLED` | the same values as on `web` (reference them too). |

Prerequisite on `web`: `WEB_PRIVATE_LISTEN_ENABLED=1` (see `api/serve_dual.py`), or `web`
cannot be reached on the private network.

## Health

`GET /__front/health` answers 200 from this app alone. It does not depend on `web`: a
restart of `web` must not take the front door out of rotation with it.

## When `web` is restarting

The app shell and assets keep loading. Passed-through requests get a 502 within 5 seconds
with `X-UCT-Front: upstream-unreachable`, which is what members get today and what the
in-app banner keys on.

## Logs

One `[front]` line per passed-through request: method, the first two path segments, status,
time to `web`'s first byte, total time. Never a full URL: paths carry tickers and share
tokens, and that is why uvicorn's own access log is off.

## Tests

- `tests/test_front_app.py`: behaviour over real sockets (static files, shell, streaming,
  uploads, headers, the fast 502, the service config).
- `tests/test_front_app_parity.py`: its tables against `api/main.py`'s source and routes.

Both run on Linux in `.github/workflows/front-door.yml`.
