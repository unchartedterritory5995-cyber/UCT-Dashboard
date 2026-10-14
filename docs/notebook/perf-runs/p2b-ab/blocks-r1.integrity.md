# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-14 13:33:41`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-typing-ab-r2; identity = 25128406c5e1a80e7bb4851743ad2245
- `2026-10-14 13:34:19`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-14 13:34:43`  **shutdown** — C:\data, 62 db files — CLEAN
