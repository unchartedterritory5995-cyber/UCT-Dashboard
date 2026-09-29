# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-28 20:03:05`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10l3; identity = 6a6bba489ac3c50f141d688fd3d7df95
- `2026-09-28 20:03:40`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 20:05:32`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-28 20:05:39`  **shutdown** — C:\data, 62 db files — CLEAN
