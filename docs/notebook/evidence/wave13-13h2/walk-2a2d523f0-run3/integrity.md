# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 21:56:00`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w13h2-walk-3; identity = 00fccbb18a890fdbed016b6c3059e80b
- `2026-10-02 21:57:36`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 21:58:22`  **shutdown** — C:\data, 62 db files — CLEAN
