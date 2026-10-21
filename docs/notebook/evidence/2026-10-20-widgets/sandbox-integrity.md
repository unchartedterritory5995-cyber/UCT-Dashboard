# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-21 06:38:40`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-widgets-walk; identity = f6392d37aa3eae09ad18660326874fbe
- `2026-10-21 06:39:08`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-21 06:40:58`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-21 06:57:52`  **shutdown** — C:\data, 62 db files — CLEAN
