# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 12:24:13`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w12b-walk5; identity = 1b0bde1f9df9e789f20a6b8e7742e944
- `2026-10-02 12:25:33`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 12:27:30`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 12:28:49`  **shutdown** — C:\data, 62 db files — CLEAN
