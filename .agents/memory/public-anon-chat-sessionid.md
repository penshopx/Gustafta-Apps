---
name: Public anonymous chat needs sessionId
description: Public conversation names are not credentials; ownership must come from the account or server session.
---
Rule: a public conversation's caller-supplied `sessionId` is only a name, never proof of ownership. Bind history, exports, writes and model-history reads to the authenticated account or an independent server-issued visitor session.

**Why:** answers can contain private document content even when the agent itself is public. Per-request RAG filtering cannot protect saved answers if another visitor can reuse the same conversation name. Historical chat rows have no trustworthy caller identity; agent ownership and knowledge of an old conversation name cannot establish who spoke.

**How to apply:** keep explicit per-conversation client names for independent conversations, but derive authorization only on the server. An omitted name must not trigger agent-wide context. Do not automatically attribute or expose historical unowned public chat rows; retain them without serving them. Cookie loss intentionally loses anonymous resumption rather than accepting a guessed conversation name as a recovery credential.
