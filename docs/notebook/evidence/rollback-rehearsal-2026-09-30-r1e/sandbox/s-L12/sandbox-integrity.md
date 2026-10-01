# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 16:35:16`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1e\data; identity = 99f8c8d7762acd072b225e0779440f5e
- `2026-09-30 16:36:52`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 16:38:48`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 16:39:01`  **shutdown** — C:\data, 62 db files — CLEAN
