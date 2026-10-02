# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 23:44:23`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w11d-data; identity = 9211e83a4cf940bd49bd2c7eac04478a
- `2026-10-01 23:45:13`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 23:47:08`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 23:48:27`  **shutdown** — C:\data, 62 db files — CLEAN
