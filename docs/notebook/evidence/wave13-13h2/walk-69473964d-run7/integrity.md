# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 22:28:20`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-7; identity = 34685a8f216f08b62f07fe17136e117d
- `2026-10-02 22:29:46`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:31:44`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:33:00`  **shutdown** — C:\data, 62 db files — CLEAN
