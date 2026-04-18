"""
Journal 2.0 backend services.

Isolated namespace: nothing here touches the existing journal_* services
or the journal_entries / trade_executions / etc. tables. All state lives
in j2_* tables created by db.ensure_schema().

Spec: docs/plans/journal-2.0-spec.md
Audit: docs/journal-2.0-integration-audit.md
"""
