# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 22:32:19`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w11a-data5; identity = 3270f503ec20f78f2797101bac2bba43
- `2026-10-01 22:33:04`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 22:34:57`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 22:35:08`  **shutdown** — C:\data, 62 db files — CLEAN
