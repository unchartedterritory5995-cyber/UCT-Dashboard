# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 05:23:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h3-h2walk-data; identity = 05d40665834de395a80b8ca99ad11670
- `2026-10-03 05:24:32`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:25:49`  **shutdown** — C:\data, 62 db files — CLEAN
