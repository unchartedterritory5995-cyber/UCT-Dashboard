# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 23:16:49`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w11c-walk-data-20261001-231639; identity = 1fb0e79a38ffb8a20eb14f49fe44bd0d
- `2026-10-01 23:17:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 23:18:12`  **shutdown** — C:\data, 62 db files — CLEAN
