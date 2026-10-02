# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 16:01:19`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\a11y2-rwp2-data2; identity = 536a590c0b79e1cc5fac26136c4607fc
- `2026-10-01 16:02:16`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 16:03:16`  **shutdown** — C:\data, 62 db files — CLEAN
