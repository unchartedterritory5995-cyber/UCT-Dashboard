# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 22:21:54`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-6; identity = 65fe65d7a4e5cb6bffc5afa7ca3b8ded
- `2026-10-02 22:23:38`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:25:35`  **shutdown** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:25:38`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
