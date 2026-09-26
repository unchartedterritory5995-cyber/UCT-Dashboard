# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 18:51:06`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = 087bb7ea706a22808099c86e9379c899
- `2026-09-26 18:51:42`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 18:52:12`  **shutdown** — C:\data, 62 db files — CLEAN
