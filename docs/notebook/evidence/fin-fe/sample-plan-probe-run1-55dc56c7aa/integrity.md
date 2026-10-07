# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 06:56:07`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\sample1; identity = 6fe879d250a2d91c29c9094f8cb53dac
- `2026-10-07 06:57:06`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 06:57:37`  **shutdown** — C:\data, 62 db files — CLEAN
