# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 22:00:32`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13q-run1; identity = bdb11354f8eaeb1bc6075564f6e47abf
- `2026-10-02 22:01:58`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:03:57`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:39:19`  **shutdown** — C:\data, 62 db files — CLEAN
