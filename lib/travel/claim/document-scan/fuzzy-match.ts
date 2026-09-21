// Small hand-rolled fuzzy text match for the two Section III names -- OCR on scanned handwriting
// varies enough that an exact string match would produce false negatives, but this app has no
// other fuzzy-matching need, so this is a short helper rather than a new dependency.

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dist[i][0] = i;
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
    }
  }
  return dist[rows - 1][cols - 1];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * True if `haystack` contains a substring within edit-distance tolerance of `target`. Deliberately
 * permissive (see `toleranceRatio`, applied as ~% of target length, minimum 2 edits) since scanned
 * handwriting OCR is imperfect -- tune the ratio in azure-provider.ts if real samples show it's
 * too loose or too strict.
 */
export function fuzzyContains(haystack: string, target: string, toleranceRatio: number): boolean {
  const normalizedTarget = normalize(target);
  const normalizedHaystack = normalize(haystack);
  if (!normalizedTarget) return false;
  const maxEdits = Math.max(2, Math.round(normalizedTarget.length * toleranceRatio));

  const minLen = Math.max(1, normalizedTarget.length - maxEdits);
  const maxLen = normalizedTarget.length + maxEdits;
  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i + len <= normalizedHaystack.length; i++) {
      const window = normalizedHaystack.slice(i, i + len);
      if (levenshteinDistance(window, normalizedTarget) <= maxEdits) return true;
    }
  }
  return false;
}
