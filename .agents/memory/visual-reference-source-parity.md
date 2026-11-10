---
name: Visual reference source parity
description: References captured from the workspace may target newer application source than an existing GitHub branch.
---

When adding visual CI to an older GitHub application, establish which application revision the reviewed reference images represent before treating failures as regressions.

**Why:** Workspace references and the GitHub application can have genuinely different navigation and layout. Fixing CI installation or a corrupted image transfer then exposes that source-version mismatch; regenerating references or relaxing thresholds would conceal it.

**How to apply:** Verify every transferred reference against the original binary checksum, not only its PNG header or a sample of files. Keep the original images unchanged when repairing transport corruption. If the referenced frontend changes are not in the target branch, obtain a decision about the intended application source before synchronizing unrelated pages or approving replacement references.

The manager chose to preserve the workspace references and include the related frontend source when initially aligning the GitHub application.

**Why:** The user selected “Pertahankan referensi workspace; sertakan frontend terkait” and delegated implementation priorities.

**How to apply:** Bring only the source and toolchain needed for that existing reference set. Do not replace it with captures of the older GitHub frontend merely to make CI pass; later intentional visual changes still follow the normal review process.
