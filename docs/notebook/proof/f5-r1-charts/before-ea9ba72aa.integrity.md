# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 21:59:06`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = 66f7785fa1240f33c9c6c2f61148b07d
- `2026-09-27 21:59:44`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 22:00:15`  **shutdown** — C:\data, 62 db files — CLEAN
