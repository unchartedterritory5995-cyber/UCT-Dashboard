# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 04:31:40`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-19; identity = 2f443e31ded908b8a309711e905b3e9a
- `2026-10-03 04:32:14`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:34:07`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:34:17`  **shutdown** — C:\data, 62 db files — CLEAN
