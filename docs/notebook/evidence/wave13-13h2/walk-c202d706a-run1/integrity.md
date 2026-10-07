# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 21:38:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-1; identity = 5609f9fae5317556dcd20d31b26df433
- `2026-10-02 21:39:37`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 21:40:27`  **shutdown** — C:\data, 62 db files — CLEAN
