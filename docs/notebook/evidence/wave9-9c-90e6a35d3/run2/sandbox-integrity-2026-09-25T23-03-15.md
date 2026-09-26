# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 23:03:21`  **pre-boot (baseline)** — C:\data, 61 db files — CLEAN
    - sandbox = C:\data-9c; identity = d401e9291b7e66dc87e56efc8295d475
- `2026-09-25 23:04:05`  **post-boot (+15s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 23:05:59`  **post-prewarm (+120s)** — C:\data, 61 db files — CLEAN
- `2026-09-25 23:09:02`  **shutdown** — C:\data, 61 db files — CLEAN
