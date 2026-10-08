# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 16:08:23`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys5-q; identity = 86c4a49bd0e5901b391b87de67352993
- `2026-10-07 16:08:56`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 16:10:47`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 16:37:13`  **shutdown** — C:\data, 62 db files — CLEAN
