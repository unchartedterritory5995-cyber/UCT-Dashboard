# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-29 21:03:11`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\dra-data\d1; identity = cb34193aa5d0c2f46f30f7edbc08e57e
- `2026-09-29 21:06:28`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 21:08:28`  **post-prewarm (+120s)** — C:\data, 62 db files — CLEAN
- `2026-09-29 21:08:54`  **shutdown** — C:\data, 62 db files — CLEAN
