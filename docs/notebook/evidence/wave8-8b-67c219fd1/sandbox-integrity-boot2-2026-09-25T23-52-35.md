# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-25 23:52:40`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-8b; identity = 8dd3070901c5fcab44ab4e8f095303a5
- `2026-09-25 23:53:15`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-25 23:55:07`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
