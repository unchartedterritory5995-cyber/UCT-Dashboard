# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 14:12:24`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\off4; identity = 6674632653b287b1a31fc1093f72b975
- `2026-10-07 14:12:57`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 14:13:21`  **shutdown** — C:\data, 62 db files — CLEAN
