/**
 * Remove numeric IDs from legacy LexSkripsi routing and sub-agent roster lines.
 * Keep all other prompt content, including user edits and legal article numbers.
 */
export function removeLexSkripsiRoutingIds(prompt: string): string {
  return prompt.replace(
    /(^[→•]\s*AGENT-(?:METODE|SUBSTANSI|LAPANGAN|SIDANG|NOTION))\s*\(\d+\)(?=\s*:)/gm,
    "$1",
  );
}