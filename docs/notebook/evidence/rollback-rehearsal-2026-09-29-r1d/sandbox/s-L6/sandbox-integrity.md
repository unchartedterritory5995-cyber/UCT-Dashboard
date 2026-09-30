# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 18:41:09`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-w10r1d; identity = dadf2136c29c6dac155554b11a489070
- `2026-09-29 18:42:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 18:44:08`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 18:44:17`  **shutdown** — C:\data, 62 db files — CLEAN
