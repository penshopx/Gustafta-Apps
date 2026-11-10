---
name: KB context visibility transition
description: Privacy boundary and compatibility choice for agent knowledge sources
---

Ruang Simpan imports are private to their importing owner, including historical imports; an import whose owner cannot be recovered must not enter any answer context. Curated platform knowledge stays shared across system agents.

**Why:** Existing knowledge has mixed provenance, and there is no reliable historical author record for non-Ruang Simpan entries. Converting all historical entries to private would silently empty existing public agents; assuming an unowned Ruang Simpan import is public would leak personal documents.

**How to apply:** When introducing new user-supplied knowledge paths, default them to private and explicitly attach the authenticated owner. Only a separately authorized publishing action should make user documents shared; do not equate agent public access with document publication.

Publication authorizes a KB copy on one agent, not its original Ruang Simpan file or trusted-app grants. Preserve deliberate consent and stamped importer ownership during historical repairs; repairs must not reclassify already labeled sources.

**Why:** Historical-import repair runs on every startup. Reapplying it indiscriminately would revoke intentional publication and could replace the importer identity with a different original-file owner.

**How to apply:** Limit historical provenance repairs to unlabeled platform imports. Publication changes must require both document ownership and agent-management permission; edits require renewed consent.

Requester permission to use a private source for a final answer is not permission to delegate that source to another agent. Keep private retrieval and saved assistant answers at the parent; delegation may carry user-authored requests and non-private knowledge.

**Why:** Reusing requester-filtered context for specialists discloses the document even on its owner's request. Forwarded assistant history can reintroduce the same private content on a later turn.

**How to apply:** Test both the specialist input and final synthesis input independently, including a resumed conversation: private content must stay absent from the specialist while remaining available to the authorized requester at the parent.