# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 16:37:24`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\folder-walk12; identity = 743c16e8f6cc2f03f1970b54b1747240
- `2026-10-07 16:37:57`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 16:39:39`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-07 16:39:48`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
