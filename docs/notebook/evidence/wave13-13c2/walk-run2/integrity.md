# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 04:10:21`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13c2-walk-data-2; identity = 3cf54090198ccc105f6259eb7cc9f528
- `2026-10-03 04:11:01`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:11:24`  **shutdown** — C:\data, 62 db files — CLEAN
