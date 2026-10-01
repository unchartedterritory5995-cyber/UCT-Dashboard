# Sandbox run — shared-data-root integrity log

Every checkpoint below hashes the main `.db` files under the shared root.
`-wal` / `-shm` are excluded: opening a WAL database read-only rewrites its
`-shm` index, so mtime there is noise. See `scripts/data_root_snapshot.py`.

- `2026-10-01 15:52:48`  **pre-boot (baseline)** — C:\data, 62 db files — CLEAN
    - sandbox = C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad\a11y2-rwlock-data3; identity = b52bcac7c32d63fa0f68a1745d20e19d
- `2026-10-01 15:53:35`  **post-boot (+15s)** — C:\data, 62 db files — CLEAN
- `2026-10-01 15:54:20`  **shutdown** — C:\data, 62 db files — CLEAN
