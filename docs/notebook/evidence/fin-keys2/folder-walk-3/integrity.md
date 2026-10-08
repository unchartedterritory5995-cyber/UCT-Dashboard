# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 15:13:44`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\folder-walk3; identity = ff6500d0935a73ae3e5ece7506fd85c7
- `2026-10-07 15:14:18`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:15:52`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:16:10`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
