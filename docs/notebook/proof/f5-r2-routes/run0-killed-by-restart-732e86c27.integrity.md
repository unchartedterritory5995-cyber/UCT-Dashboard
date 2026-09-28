# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-27 22:16:35`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10f5; identity = ca344298993d7dd104d574dc4c573517
- `2026-09-27 22:17:32`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-27 22:19:28`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
