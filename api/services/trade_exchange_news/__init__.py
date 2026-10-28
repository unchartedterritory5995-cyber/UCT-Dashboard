"""Trade Exchange News -- web's half of the durable handoff (Checkpoint B).

    receiver service ──push (private net)──▶ internal ingest ─┐
          │                                                   ├─▶ pipeline ─▶ store (SQLite, ordered seq)
          └──R2 journal (durable) ◀──list/get── reconciler ───┘            └─▶ hub ─▶ subscribers

* ``config``         -- every knob, read from the environment, DARK by default.
* ``records``        -- validation of a journal record (push and recovery share it).
* ``store``          -- the bounded history and the delivery ledger; assigns ``seq``.
* ``hub``            -- in-process fan-out, one ordered stream for every subscriber.
* ``pipeline``       -- the single writer: store first, then publish, in seq order.
* ``journal_reader`` -- web's read-only view of the receiver's R2 journal.
* ``reconcile``      -- boot + periodic recovery of anything a push never delivered.
"""
