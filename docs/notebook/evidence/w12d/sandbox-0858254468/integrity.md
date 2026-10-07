# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-02 12:29:40`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\w12d-data-ev1; identity = ed2d1da6948a4a0599a99fde6bcbf01a
- `2026-10-02 12:31:08`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-02 12:31:46`  **shutdown** — C:\data, 62 db files — CLEAN
