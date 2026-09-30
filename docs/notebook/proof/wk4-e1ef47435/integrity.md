# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 00:12:56`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\wk4-data; identity = 3fd2364974646afb95a4a47f2b2dcb8f
- `2026-09-30 00:14:27`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 00:16:25`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 01:22:05`  **shutdown** — C:\data, 62 db files — CLEAN
