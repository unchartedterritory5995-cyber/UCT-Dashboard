# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-26 20:23:15`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10b; identity = 515282abf3c52ab69bae8a43b3badc4e
- `2026-09-26 20:23:53`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:25:44`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-26 20:25:51`  **shutdown** — C:\data, 62 db files — CLEAN
