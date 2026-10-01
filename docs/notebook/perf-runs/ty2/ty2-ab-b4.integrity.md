# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 21:09:36`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\ty2-ab-b4-data; identity = 1486cde13134ee782f026acc963f498b
- `2026-09-30 21:11:02`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 21:11:29`  **shutdown** — C:\data, 62 db files — CLEAN
