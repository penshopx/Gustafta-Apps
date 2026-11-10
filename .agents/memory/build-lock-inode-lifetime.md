---
name: Build lock inode lifetime
description: Why a file-based build promotion lock must not be removed after use.
---

Keep the OS-level build lock file in place even after the lock has been released.

**Why:** Removing a lock file creates an inode split: a waiting process can hold a lock on the old, unlinked inode while a new process creates and locks another file at the same path. Both could promote releases concurrently. An inherited open file description also releases its lock on process death without needing to delete the file.

**How to apply:** When adjusting the build/promotion lock or cleaning workspace files, do not unlink the lock target as part of normal completion or stale-file cleanup. Lock and unlock the same persistent inode.