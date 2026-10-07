# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-06 23:13:44`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-fe\control; identity = 53d24b7a6b4bc5e4f74985e65c6e5cff
- `2026-10-06 23:14:31`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 23:16:27`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-06 23:16:34`  **shutdown** — C:\data, 62 db files — CLEAN
