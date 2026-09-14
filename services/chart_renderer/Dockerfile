# chart-renderer — headless Chromium screenshot service for the house chart image.
# Base image ships Chromium + every OS dependency Playwright needs.
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ⚠️ FILES ARE COPIED INDIVIDUALLY — a new module that is not listed here is an
# ImportError at boot, which takes the renderer down rather than degrading.
COPY app.py .
COPY edge_scope.py .
COPY serve.py .

ENV PORT=8080
# ⚰️ WAS: `uvicorn app:app --host :: --port ${PORT}` — right instinct, wrong
# implementation. Railway's private network IS IPv6 (so `0.0.0.0` would be
# unreachable from web), but `--host ::` is IPv6-ONLY: CPython's asyncio forces
# IPV6_V6ONLY on every AF_INET6 server socket. Railway's healthcheck probe
# arrives over IPv4, so it could never connect — 11 failed attempts against a
# healthy, already-rendering app, with ZERO `GET /health` lines to show for it.
# `serve.py` binds ONE dual-stack socket (IPv6 + IPv4) and hands it to uvicorn.
CMD ["sh", "-c", "exec python -u serve.py"]
