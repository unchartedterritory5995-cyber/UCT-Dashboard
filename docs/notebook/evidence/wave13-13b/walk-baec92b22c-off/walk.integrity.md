# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 23:41:28`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13b-data-off; identity = d291ae14e2d0e7959e641ab185d3e821
- `2026-10-02 23:43:16`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:45:15`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:45:37`  **shutdown** — C:\data, 62 db files — CLEAN
