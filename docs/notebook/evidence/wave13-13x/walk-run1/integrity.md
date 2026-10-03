# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 09:47:45`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\w13x-walk-data; identity = 9d9e0beb2a5c4217aa6fda37c7a70e36
- `2026-10-03 09:49:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 09:51:59`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 09:52:53`  **shutdown** — C:\data, 62 db files — CLEAN
