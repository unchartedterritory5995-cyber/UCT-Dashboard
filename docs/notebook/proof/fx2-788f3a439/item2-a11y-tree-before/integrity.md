# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 00:58:22`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\fx2-data; identity = abbabe565faf295f1b46a7db72cb1568
- `2026-09-30 00:59:08`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 00:59:39`  **shutdown** — C:\data, 62 db files — CLEAN
