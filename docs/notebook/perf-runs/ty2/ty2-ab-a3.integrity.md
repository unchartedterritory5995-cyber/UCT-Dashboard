# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 20:52:40`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\ty2-ab-a3-data; identity = b100b6df0df74d280199860e99a32fb6
- `2026-09-30 20:54:08`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 20:54:39`  **shutdown** — C:\data, 62 db files — CLEAN
