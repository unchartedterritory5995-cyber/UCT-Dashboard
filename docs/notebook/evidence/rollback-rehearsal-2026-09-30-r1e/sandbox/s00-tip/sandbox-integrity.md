# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 16:30:40`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\r1e\data; identity = a9d556ce355a8f437a8a29130c83297c
- `2026-09-30 16:32:10`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 16:34:05`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 16:34:21`  **shutdown** — C:\data, 62 db files — CLEAN
