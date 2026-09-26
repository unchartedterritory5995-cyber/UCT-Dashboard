"""Who is a member? The three populations, for the 30-day soak's server read.

⛔⛔ ONE FACT IN TWO FILES, PINNED AGAINST EACH OTHER. The lists below are the
same three the Wave Q1 sampler carries in `tools/nb_observe.py`
(`RIG_AND_OWNER`, `SYNTHETIC_MEMBERS`, `INTERNAL_DOMAIN`). The sampler runs from
a COPY outside every worktree (`C:\\Users\\Patrick\\uct-q1-observe\\`), so it
cannot import `api` — which is why the fact lives twice. It is never restated by
hand: `tests/test_notebook_populations.py` reads the sampler's three constants
by AST and asserts they equal these, so a change to one file without the other
goes red the day it lands.

The populations, and why they are never summed:

  organic           a person who is not us. The ONLY population the soak's
                    "zero data loss" claim may be divided by.
  synthetic         an account WE provisioned (the smoke accounts, the benchmark
                    account). It proves a path is reachable and says nothing
                    about adoption.
  rig_owner         the instrument and the owner's own browsing — one account.
  unknown_internal  an address on our own reserved `.internal` domain that no
                    list declares. `.internal` is unroutable (RFC 8375), so
                    nobody outside this programme can hold one: a new one is a
                    synthetic account somebody provisioned without saying so.
                    It is FLAGGED, never counted as organic.

⛔ BY FULL, LOWER-CASED EMAIL — NEVER BY PREFIX OR SUBSTRING. A
`startswith("smoke")` test would catch `member-smoke@` only by luck, would
wrongly catch `smoke@gmail.com`, and a substring test would silently swallow a
real member whose address happens to contain one of these words. The sampler's
own comment (`nb_observe.py`, "BY FULL EMAIL, NEVER BY PREFIX") is the record
of why.
"""
from __future__ import annotations

# The shared owner+rig account. Canary runs, probes and the owner's own human
# browsing all land here; none of them is an independent member.
RIG_AND_OWNER = ("unchartedterritory5995@gmail.com",)

# Accounts this programme provisioned. `bench@` is ruling D-9A3's benchmark
# account (controller-provisioned when lane 9A runs); it is listed here AND in
# `tools/nb_observe.py` in the same commit, so the day it first signs in it
# reads as synthetic rather than as an UNKNOWN INTERNAL anomaly.
SYNTHETIC_MEMBERS = (
    "smoke@uctintelligence.internal",            # the post-deploy client smoke
    "member-smoke@uctintelligence.internal",     # T-12's independent-member view
    "bench@uctintelligence.internal",            # D-9A3's head-to-head benchmark
)

INTERNAL_DOMAIN = "@uctintelligence.internal"

#: Every population `population_of` can return, in the order reports print them.
POPULATIONS = ("organic", "synthetic", "rig_owner", "unknown_internal")


def population_of(email: str) -> str:
    """`'organic' | 'synthetic' | 'rig_owner' | 'unknown_internal'`.

    Matched on the FULL, lower-cased, stripped address — equality, never a
    prefix, never a substring. The domain test is an exact suffix that
    includes the `@`, so `x@notuctintelligence.internal` is not internal.

    ⛔ The caller decides what an identity with NO email means (a deleted
    user, an anonymous report). This function is only ever handed an address:
    an empty one is refused rather than quietly filed as organic, because
    "we could not tell who this was" must never read as a real member.
    """
    if not isinstance(email, str) or not email.strip():
        raise ValueError("population_of needs an email address; an identity "
                         "without one is the caller's to report, never organic")
    e = email.strip().lower()
    if e in RIG_AND_OWNER:
        return "rig_owner"
    if e in SYNTHETIC_MEMBERS:
        return "synthetic"
    if e.endswith(INTERNAL_DOMAIN):
        return "unknown_internal"
    return "organic"
