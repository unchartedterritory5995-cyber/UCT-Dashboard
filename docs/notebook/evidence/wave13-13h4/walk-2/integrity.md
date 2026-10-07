# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-03 10:22:57`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h4-walk-data-2; identity = 1ececca216b322cf511efe77d500bc42
- `2026-10-03 10:24:17`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-03 10:25:29`  **shutdown** — C:\data, 62 db files — CLEAN
