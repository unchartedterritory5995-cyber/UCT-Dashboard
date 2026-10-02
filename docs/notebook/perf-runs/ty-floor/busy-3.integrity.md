# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 12:55:29`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\ty4-busy-3; identity = 9c8eb0985a17eb1ac6adbc0e318b857b
- `2026-10-01 12:56:16`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 12:56:34`  **shutdown** — C:\data, 62 db files — CLEAN
