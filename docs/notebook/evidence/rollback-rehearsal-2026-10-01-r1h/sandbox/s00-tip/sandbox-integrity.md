# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 20:15:06`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1h-sandbox\data; identity = 13eb71f66009d55f9146de10d2701775
- `2026-10-01 20:16:45`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 20:18:39`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 20:18:49`  **shutdown** — C:\data, 62 db files — CLEAN
