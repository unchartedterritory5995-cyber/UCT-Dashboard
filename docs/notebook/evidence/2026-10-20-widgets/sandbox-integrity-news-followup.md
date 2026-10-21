# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-21 06:59:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-widgets-walk; identity = 230e446b51156df3a919b29e2b07c812
- `2026-10-21 06:59:30`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-21 06:59:43`  **shutdown** — C:\data, 62 db files — CLEAN
