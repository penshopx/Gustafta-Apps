---
name: Monitor recovery delivery ambiguity
description: Why recovery notifications use a durable delivery claim and stop on uncertain outcomes
---

Persist a recovery claim before sending an external email. A failure to contact the provider, a provider 5xx, or a failed acknowledgement write after sending cannot prove whether the email arrived. Do not automatically retry from that state; require an operator to verify delivery and explicitly choose to mark it delivered or retry. Definitive pre-send or provider-rejection failures may release the claim for retry.

**Why:** Email delivery and state updates cannot participate in one atomic transaction. Retrying an ambiguous outcome can send duplicate recovery notifications, while discarding the failed baseline can silently lose a recovery.

**How to apply:** For any monitor using an external notification channel, keep the last failed baseline until a durable claim is recorded, and block unattended retries while delivery remains uncertain. Persist only allowlisted status categories or names, never raw URLs or provider responses.