# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 15:26:48`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\folder-walk6; identity = 2b858f1b750bf9b88f9b9ad5bf581907
- `2026-10-07 15:27:23`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:29:14`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 15:29:47`  **shutdown** — C:\data, 62 db files — CLEAN
