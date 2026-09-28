/**
 * Token estimation.
 *
 * Deliberately biased HIGH. This number exists to bound cost risk, so
 * under-estimating is the dangerous direction. If the estimate lands somewhere
 * awkward, the real measurement (via `providers/`) is what settles it.
 */

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x3000, 0x303f], // CJK punctuation
  [0x3400, 0x4dbf], // CJK unified ideographs extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xff00, 0xffef], // fullwidth forms
];

function isCjk(codePoint: number): boolean {
  for (const [lo, hi] of CJK_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/**
 * Rough token count for mixed text.
 *
 * CJK is counted at ~1 token per character and everything else at ~1 token per
 * 4 characters. A blanket `chars / 4` would under-count Chinese by roughly 4x,
 * which matters here because the delivery language is Chinese while the corpus
 * is English — so a session is inherently mixed.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (isCjk(cp)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/**
 * An ASCII filler string whose estimated token count is approximately `n`.
 * Used to drive the fake provider with realistic input sizes.
 */
export function fillerForTokens(n: number): string {
  return "x".repeat(Math.max(0, n) * 4);
}
