# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 13:06:30`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\data-fin-clicks\stall-base1; identity = 1e475a6e1228fa5eac0274dded0ae084
- `2026-10-07 13:07:09`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:09:02`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 13:11:49`  **shutdown** — C:\data, 62 db files — CLEAN
