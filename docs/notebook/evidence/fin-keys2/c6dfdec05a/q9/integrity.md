# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 15:02:18`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys4-q9; identity = 61c4a36c27a0f962a75ec4ba182ef09c
- `2026-10-07 15:02:54`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:04:46`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:05:19`  **shutdown** — C:\data, 62 db files — CLEAN
