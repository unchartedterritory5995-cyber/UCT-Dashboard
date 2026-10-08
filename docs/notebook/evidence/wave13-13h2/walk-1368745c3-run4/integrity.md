# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 22:01:16`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-4; identity = 2fad098cb0a85f25d4e700dd23643784
- `2026-10-02 22:03:24`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:05:23`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 22:08:20`  **shutdown** — C:\data, 62 db files — CLEAN
