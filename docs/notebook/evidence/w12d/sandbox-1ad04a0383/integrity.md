# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 12:36:27`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w12d-data-ev2; identity = 9892da79f01251b835326e9b656b3564
- `2026-10-02 12:37:40`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 12:38:09`  **shutdown** — C:\data, 62 db files — CLEAN
