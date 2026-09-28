# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 16:52:41`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10rb; identity = 8dcdfab9bd9e99f6375e56bc9a2baa5d
- `2026-09-28 16:53:41`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:55:33`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 16:55:40`  **shutdown** — C:\data, 62 db files — CLEAN
