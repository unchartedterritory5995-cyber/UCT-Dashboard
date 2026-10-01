# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 17:28:02`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\ty2-baseline-data; identity = 222360965bbe8d70c2f52136a35149f5
- `2026-09-30 17:29:32`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 17:29:43`  **shutdown** — C:\data, 62 db files — CLEAN
