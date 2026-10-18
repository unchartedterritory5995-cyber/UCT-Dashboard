# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-17 23:14:02`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-t3typing-abB2; identity = 15510d85a144cdccf3c5f4ade0b2a251
- `2026-10-17 23:14:36`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-17 23:14:56`  **shutdown** — C:\data, 62 db files — CLEAN
