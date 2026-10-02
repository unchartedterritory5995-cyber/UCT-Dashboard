# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 20:22:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1h-sandbox\data; identity = 77b168868646c5bc2f613af20e111e46
- `2026-10-01 20:23:31`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 20:25:25`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 20:25:35`  **shutdown** — C:\data, 62 db files — CLEAN
