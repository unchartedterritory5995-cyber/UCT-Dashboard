# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 20:43:11`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\ty2-ab-b2-data; identity = 11ca1254e0bac851fc524e79f8fdb5e5
- `2026-09-30 20:47:06`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 20:48:18`  **shutdown** — C:\data, 62 db files — CLEAN
