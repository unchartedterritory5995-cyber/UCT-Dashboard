# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 20:28:15`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1h-sandbox\data; identity = 8bcda78135ef54feb64957a3358a2128
- `2026-10-01 20:29:22`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 20:31:16`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 20:31:25`  **shutdown** — C:\data, 62 db files — CLEAN
