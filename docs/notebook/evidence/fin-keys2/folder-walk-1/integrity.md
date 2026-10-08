# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 15:05:59`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\folder-walk1; identity = 599858508b9c22d903402feb4bb10ae5
- `2026-10-07 15:06:38`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:08:31`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:09:18`  **shutdown** — C:\data, 62 db files — CLEAN
