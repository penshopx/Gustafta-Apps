---
name: External document grants
description: Intent and trust boundary for app-to-app Ruang Simpan document access.
---

External application tokens must never imply access to every document of the owner. Profile permissions and document permissions are independent; document access additionally requires explicit owner-selected file or folder targets, checked at read time. A folder selection intentionally follows its current membership, including new files placed in it and excluding files moved away.

**Why:** A profile integration was previously limited to structured company fields. Treating that existing trust as permission for the entire vault would expose unrelated private documents. Dynamic folder membership is convenient for ongoing workflows but must be made clear to owners.

**How to apply:** Any future document endpoint must check token status, account ownership, action scope, and current selection together. Uploads should use the vault's normal quota, ingestion, and audit path rather than direct database writes from another app.