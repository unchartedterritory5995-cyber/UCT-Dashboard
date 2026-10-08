# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 15:51:31`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\folder-walk11; identity = fdbe95b6b21e45fecb447a14035aff1c
- `2026-10-07 15:52:07`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:53:37`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:53:58`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
