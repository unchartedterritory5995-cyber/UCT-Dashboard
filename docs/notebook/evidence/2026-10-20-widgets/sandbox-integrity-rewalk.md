# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-21 07:22:31`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-widgets-walk; identity = 58720152f01aa83e9fd616d6cb98c95e
- `2026-10-21 07:22:59`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-21 07:24:50`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-21 07:26:11`  **shutdown** — C:\data, 62 db files — CLEAN
