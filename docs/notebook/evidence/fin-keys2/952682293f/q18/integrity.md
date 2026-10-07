# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 16:41:04`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys5-q18; identity = d725b0c57056cd6d6bcb721c3495a462
- `2026-10-07 16:41:39`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 16:43:31`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 16:43:58`  **shutdown** — C:\data, 62 db files — CLEAN
