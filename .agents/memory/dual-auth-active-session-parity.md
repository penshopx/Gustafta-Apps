---
name: Dual-auth active-session parity
description: Protected routes must recognize both OIDC and email sessions while enforcing the same account-revocation policy.
---

**Rule:** Never use `req.isAuthenticated()` as the sole login check in this project. Protected middleware and middleware-free special branches (such as a paid gate inside a public chat route) must use the same shared authentication checker so OIDC and `session.emailUser` identities are normalized identically. Once the checker authorizes a request, use **its returned user ID** for every owner-scoped operation; do not re-read `req.user` to choose an owner.

**Why:** Email-session buyers were rejected by paid status/admin routes when only Passport auth was checked. Accepting the email-session ID directly fixed login but accidentally let inactive or blocked users keep using a paid stream. Identity recognition and active-account revocation must remain one policy. Email and Passport sessions can coexist in one browser; authorizing the email principal but resolving ownership from stale Passport `req.user` can cross account boundaries.

**How to apply:** Use the shared checker for protected routes and carry its verified ID through the handler. If a route must stay public and cannot mount auth middleware globally, call the shared checker only inside its protected branch. Test happy paths for both auth modes, mixed simultaneous sessions with different IDs, plus inactive/blocked denial with no quota or state mutation.