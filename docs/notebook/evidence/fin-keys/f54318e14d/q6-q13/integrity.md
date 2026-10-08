# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 12:40:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\keys2-q6c; identity = 0e1499a4eba4fd1ba601bc59c512df8b
- `2026-10-07 12:41:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:42:55`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 12:47:17`  **shutdown** — C:\data, 62 db files — CLEAN
