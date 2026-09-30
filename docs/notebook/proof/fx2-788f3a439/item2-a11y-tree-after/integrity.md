# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-09-30 01:01:05`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\fx2-data; identity = d121cf74b547a73fd0101f3e9972f4e3
- `2026-09-30 01:01:54`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-09-30 01:02:21`  **shutdown** — C:\data, 62 db files — CLEAN
