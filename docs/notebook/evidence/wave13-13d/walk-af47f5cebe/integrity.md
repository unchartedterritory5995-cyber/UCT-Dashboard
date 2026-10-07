# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 22:29:31`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13d-walk-data-3; identity = 6fc2b1f4dc79d407a4a1568b4a777651
- `2026-10-02 22:31:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:33:33`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:35:54`  **shutdown** — C:\data, 62 db files — CLEAN
