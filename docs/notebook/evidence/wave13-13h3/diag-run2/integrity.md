# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 05:01:09`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h3-diag-data2; identity = c278821383ba73d47dec7061b051720d
- `2026-10-03 05:01:51`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 05:02:26`  **shutdown** — C:\data, 62 db files — CLEAN
