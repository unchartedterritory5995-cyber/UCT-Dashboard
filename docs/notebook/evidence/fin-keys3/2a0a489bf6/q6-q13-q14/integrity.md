# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-07 18:15:51`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\fin\keys3\data-q6; identity = b3d07534bf1a6ef144af9711f015c21c
- `2026-10-07 18:16:25`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 18:18:18`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-07 18:22:13`  **shutdown** — C:\data, 62 db files — CLEAN
