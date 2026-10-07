# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 23:23:54`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-9; identity = e7c84ada4497fc1a2cfef73c818cff9a
- `2026-10-02 23:25:31`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:27:29`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:28:03`  **shutdown** — C:\data, 62 db files — CLEAN
