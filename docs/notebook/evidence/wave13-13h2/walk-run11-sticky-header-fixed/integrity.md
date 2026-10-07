# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 23:47:03`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-11; identity = 44fc45c0eaafb7546aa1ec41581141c3
- `2026-10-02 23:48:34`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:50:30`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 23:53:06`  **shutdown** — C:\data, 62 db files — CLEAN
