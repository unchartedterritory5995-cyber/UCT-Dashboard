# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 00:16:47`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w11d-data; identity = b871846fc5c2e6d8a69536558ada07c7
- `2026-10-02 00:17:19`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 00:19:09`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 00:19:15`  **shutdown** — C:\data, 62 db files — CLEAN
