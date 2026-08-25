# chart-renderer — headless Chromium screenshot service for the house chart image.
# Base image ships Chromium + every OS dependency Playwright needs.
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV PORT=8080
# `::` — Railway's private network is IPv6-only; binding 0.0.0.0 is unreachable from web.
CMD ["sh", "-c", "exec uvicorn app:app --host :: --port ${PORT}"]
