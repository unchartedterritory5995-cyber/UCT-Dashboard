# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 19:12:45`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\fin\keys3\data-lo1; identity = 7e6fe232df132f6b14c71f4bb689b15a
- `2026-10-07 19:13:19`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 19:14:50`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-07 19:15:10`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
