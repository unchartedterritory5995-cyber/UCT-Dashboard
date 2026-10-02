# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 00:06:01`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w11d-data; identity = 5a75271ebb7257b26fbe25adaf9453b5
- `2026-10-02 00:06:33`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 00:08:24`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 00:08:31`  **shutdown** — C:\data, 62 db files — CLEAN
