/**
 * Search narrowly by title instead of paging through every repository issue.
 * Search may be incomplete or capped; neither condition proves a marker absent.
 */
export async function findIssueByTitle<T extends { title: string; pull_request?: unknown }>(
  repository: string,
  title: string,
  api: (path: string) => Promise<unknown>,
  duplicateMessage: string,
): Promise<T | undefined> {
  const query = encodeURIComponent(`repo:${repository} in:title "${title.replace(/"/g, '\\"')}"`);
  let found: T | undefined;
  let count = 0;
  for (let page = 1; ; page++) {
    const result = await api(`/search/issues?q=${query}&per_page=100&page=${page}`);
    if (!result || typeof result !== "object") throw new Error("Invalid issue search");
    const { total_count, incomplete_results, items } = result as Record<string, unknown>;
    if (!Number.isSafeInteger(total_count) || (total_count as number) < 0 ||
        (total_count as number) >= 1000 || incomplete_results !== false || !Array.isArray(items)) {
      throw new Error("Incomplete issue search");
    }
    count += items.length;
    if (count > (total_count as number) || (items.length === 0 && count < (total_count as number))) {
      throw new Error("Invalid issue search");
    }
    for (const issue of items as T[]) {
      if (!issue || typeof issue.title !== "string") throw new Error("Invalid issue search");
      if (issue.title !== title || issue.pull_request) continue;
      if (found) throw new Error(duplicateMessage);
      found = issue;
    }
    if (count === total_count) break;
    if (items.length !== 100 || page >= 10) throw new Error("Incomplete issue search");
  }
  // Search indexing is asynchronous. Inspect the live newest page as well so a
  // claim created seconds ago cannot be missed by the search index on retry.
  const recent = await api("/issues?state=all&sort=created&direction=desc&per_page=100&page=1");
  if (!Array.isArray(recent)) throw new Error("Invalid issue list");
  for (const issue of recent as T[]) {
    if (!issue || typeof issue.title !== "string") throw new Error("Invalid issue list");
    if (issue.title !== title || issue.pull_request) continue;
    if (found && (found as T & { number: number }).number !== (issue as T & { number: number }).number) {
      throw new Error(duplicateMessage);
    }
    found = issue;
  }
  return found;
}