# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 18:21:51`  **pre-boot (baseline)** — C:\data, 0 db files — CLEAN
    - sandbox = C:\data-navmeasure; identity = ff0a75b0146dc7444f8a76761e039edc
- `2026-10-07 18:23:46`  **post-boot (+15s)** — C:\data, 0 db files — CLEAN
- `2026-10-07 18:25:31`  **post-prewarm (+120s)** — C:\data, 0 db files — CLEAN
- `2026-10-07 18:28:42`  **shutdown** — C:\data, 0 db files — CLEAN
