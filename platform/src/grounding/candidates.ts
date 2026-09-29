import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { SESSIONS_DIR } from "../catalog.ts";
import type { UnlistedConcern } from "../session/apparatus.ts";

/**
 * Where unrecognised concerns go.
 *
 * A QUEUE for the Domain owner, not the Misconception catalogue. ADR 0004 requires every
 * entry to be reachable from a check, so promoting one of these is a piece of authoring
 * rather than a line of bookkeeping: an entry nobody can diagnose is exactly the
 * unfalsifiable entry that rule exists to prevent. This file makes one narrower promise
 * — that the evidence survives the session. Dropping it meant the catalogue could only
 * ever contain what somebody had thought of in advance.
 *
 * It lives under the session area, and the path is NOT a parameter. The queue holds the
 * learner's own words, which ADR 0002 makes sensitive, so it must never be committed —
 * and a per-Domain `candidates.md` would be committed by the next `git add -A`. Not
 * exposing the path is the difference between a rule and a hope; promoting a candidate
 * means writing an entry in the Domain's own words, the same way the corpus paraphrases
 * its sources instead of quoting them.
 */
export const CANDIDATES_DIR = join(SESSIONS_DIR, "candidates");

/** The line a recorded answer is written on, and read back from. */
const ANSWER_LINE = /^- 学习者原话：(.*)$/gm;

function header(domainId: string): string {
  return [
    `# Candidates — ${domainId}`,
    "",
    "Sessions that reported a concern matching NO catalogue entry. Each one is evidence",
    "that the catalogue is short, and none of them is an entry yet.",
    "",
    "This file is LOCAL and must stay uncommitted: it holds the learner's own words.",
    "To promote one, write the entry in the Domain's `misconceptions.md` **in the",
    "project's own words**, and a check that diagnoses it in `checks.md`. `npm run",
    "validate` fails on an entry no check can reach (ADR 0009), so the pair is not",
    "optional — a wrong idea nobody can ask about is a wrong idea nobody can refute.",
    "",
    "Delete a candidate once it has been promoted, or judged not worth one. This is a",
    "queue; an empty queue is the good state.",
    "",
  ].join("\n");
}

function recordedAnswers(markdown: string): Set<string> {
  const answers = new Set<string>();
  for (const match of markdown.matchAll(ANSWER_LINE)) {
    const answer = match[1];
    if (answer !== undefined) answers.add(answer.trim());
  }
  return answers;
}

/**
 * Append unrecognised concerns, ignoring ones already queued.
 *
 * Returns how many were NEW, so a caller can say "nothing to look at" instead of
 * reporting a write that did nothing. Deduplicated on the learner's own words: two
 * people phrasing the same wrong idea differently are two candidates, and there is no
 * safe way to be cleverer about that here — collapsing them is a judgement about the
 * Domain, and this function does not make those.
 */
export function recordCandidates(
  domainId: string,
  concerns: readonly UnlistedConcern[],
  now: Date = new Date(),
): number {
  if (concerns.length === 0) return 0;

  const path = join(CANDIDATES_DIR, `${domainId}.md`);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : header(domainId);
  const seen = recordedAnswers(existing);

  const fresh = concerns.filter((concern) => {
    const answer = concern.answer.trim();
    if (answer === "" || seen.has(answer)) return false;
    seen.add(answer);
    return true;
  });
  if (fresh.length === 0) return 0;

  const day = now.toISOString().slice(0, 10);
  const blocks = fresh.map((concern) =>
    [
      `## ${concern.probeId} — ${day}`,
      "",
      `- 学习者原话：${concern.answer.trim()}`,
      `- 判为「有疑虑但未匹配到条目」的理由：${concern.reason}`,
      "- 待办：由 Domain 的 owner 判断它值不值得成为条目。",
      "",
    ].join("\n"),
  );

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${existing.replace(/\s*$/, "")}\n\n${blocks.join("\n")}`, "utf8");
  return fresh.length;
}
