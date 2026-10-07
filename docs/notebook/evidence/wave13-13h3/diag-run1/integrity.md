# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 04:56:17`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h3-diag-data; identity = 4f4485e848c7d0a6d807b0fa1f699c7c
- `2026-10-03 04:57:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 04:58:05`  **shutdown** — C:\data, 62 db files — CLEAN
