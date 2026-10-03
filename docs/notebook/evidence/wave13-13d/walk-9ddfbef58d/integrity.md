# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 23:01:08`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13d-walk-data-5; identity = dd72319ecb99060aa9afd9e23df63426
- `2026-10-02 23:02:44`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:04:41`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:06:01`  **shutdown** — C:\data, 62 db files — CLEAN
