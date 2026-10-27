# Trade Exchange — questions before real traffic

UCT will receive Trade Exchange's breaking-news webhook (today documented only as
`{"source": "TXNews1", "content": "..."}`) at a dedicated endpoint. Before we
connect it, we need the following confirmed, ideally in writing.

**Authentication**
1. Can a webhook destination carry a custom header (e.g. `Authorization: Bearer …`
   or `X-TXN-Token`), or a URL with embedded credentials (`https://user:pass@host/...`)?
   If neither, we will use a long random secret in the URL path.
2. Do you sign requests (e.g. an HMAC header)? If so, the algorithm and header name.

**Delivery behaviour**
3. Do you retry a failed delivery? On which responses (5xx, 429, timeouts)? How many
   times, over what period, with what backoff?
4. Your request timeout: how long do you wait for our response?
5. Which responses count as success — any 2xx, or specifically 200 / 204?
6. Is there a delivery or message identifier (body field or header) we can use to
   recognise a retry of the same message?
7. Can the same headline be sent more than once deliberately (e.g. an update or
   re-publication)? How should we tell that apart from a retry?
8. Do you publish fixed sending IP addresses or ranges?

**Content**
9. Is `source` always `TXNews1`? Will other source values appear (other desks,
   channels, test messages)?
10. Are corrections, edits or deletions ever sent? In what form?
11. Is there a publication timestamp we should display (we currently show our own
    receipt time and label it as such)?
12. Maximum message length; can `content` contain markup, links or line breaks?

**Rights**
13. May we **store** headlines, and for how long? (Our design keeps 7 days of
    history plus an 8-day recovery copy.)
14. May we **redistribute** headlines to our members inside our platform (a live
    feed and on-platform alerts — in-app, and email/push if enabled)?
15. Required **attribution** (wording, placement, logo) and any display rules.
16. Restrictions on use in alerts, emails, notifications or exports.
17. Any notice or termination terms affecting stored data.
