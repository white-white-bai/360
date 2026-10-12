import { hasTwoReviewers, type Domain } from "../experts/types.ts";
import type { Profession, ProfessionIndex, Risk, Tier } from "./load.ts";

/**
 * The review lifecycle (ADR 0018): how long a signature stays good.
 *
 * ADR 0006 and ADR 0010 record who signed a Domain and when. Neither records how
 * long that signature lasts — and a signature is a statement about a corpus AT A
 * DATE: these passages say this, and I checked the documents they cite. The
 * documents are not frozen. RFCs are superseded, standards are revised, a page
 * that answered in 2024 404s in 2027. Seven Domains fit in one person's head;
 * one thousand six hundred and thirty-nine do not, and the failure is not
 * dramatic: a Domain reviewed in 2024 keeps rendering exactly as it did, and
 * nothing anywhere says the ground moved.
 *
 * Everything here is arithmetic over dates a person wrote. Nothing here reads
 * the clock — `today` is an argument (decision 5) — and nothing here changes a
 * Profession's status or closes a door (decision 4). Expiry is a maintenance
 * signal: it says the reading is old, not that the reading was wrong.
 */

/**
 * How long a Profession's pace allows a Domain to go unread.
 *
 * Two dials, answered separately: Tier says how much of a Profession can be
 * taught here, Risk says what happens if the platform teaches it wrong. The
 * composition rule is `min`, not a lookup grid — the dials are decided
 * independently, so a grid would have to be re-decided every time either one
 * gains a value, and a minimum is the conservative direction: the stricter dial
 * sets the pace, and that is the one whose failure is the failure that matters.
 *
 * A high-risk line is re-read within a quarter whatever its Tier, because the
 * failure this platform exists to prevent is asserting something confidently
 * off a source that has since moved.
 */
export const TIER_DAYS: Record<Tier, number> = { A: 365, B: 365, C: 730 };
export const RISK_DAYS: Record<Risk, number> = { ordinary: 730, high: 90 };

export function reviewIntervalDays(tier: Tier, risk: Risk): number {
  return Math.min(TIER_DAYS[tier], RISK_DAYS[risk]);
}

/**
 * The interval a Domain no Profession lists gets — the Tier A ordinary rate, and
 * with it the strictest an ordinary line can ever be. Derived from the dials
 * rather than written as `365`, so the two cannot drift apart.
 *
 * This is the one place this policy does not fail closed, and there is nothing
 * to fail closed *against*: an unclaimed Domain has no consumer to hurt, and
 * `domain.unlisted` already names it as unclaimed. Two rules saying "nobody
 * depends on this" would not make it twice as true.
 */
export const BASE_INTERVAL_DAYS = reviewIntervalDays("A", "ordinary");

const DAY_MS = 86_400_000;

/** The real date. Read only at the edge, and passed in everywhere else. */
export function todayISO(): string {
  return new Date(Date.now()).toISOString().slice(0, 10);
}

/** An ISO date (`YYYY-MM-DD`) at midnight UTC, or `undefined` when it is not a date at all. */
function dayOf(iso: string): number | undefined {
  const ms = Date.parse(`${iso.trim()}T00:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * The day a Domain's clock starts: its most recent read (decision 2).
 *
 * A second signature IS a read — ADR 0017 made it a field rather than a gesture
 * — so a Domain someone re-read in 2026 is not stale because someone else first
 * signed it in 2024. `hasTwoReviewers` is ADR 0017's one predicate, reused
 * rather than re-derived: a half-filled or placeholder pair must not move the
 * anchor, and deciding that is exactly what the predicate already does.
 */
export function reviewAnchor(domain: Domain): string {
  const second = domain.secondReviewedOn;
  if (!hasTwoReviewers(domain) || second === undefined) return domain.corpusReviewedOn;

  const firstDay = dayOf(domain.corpusReviewedOn);
  const secondDay = dayOf(second);
  // Compared, not assumed from field order: nothing in the asset layer forces
  // the second date to be the later one. An anchor that will not parse stays the
  // first date, which leaves the due date unknown rather than invented.
  if (firstDay === undefined || secondDay === undefined) return domain.corpusReviewedOn;
  return secondDay > firstDay ? second : domain.corpusReviewedOn;
}

/** The day a Domain comes due, or `undefined` when its anchor will not parse. */
export function reviewDueOn(domain: Domain, intervalDays: number): string | undefined {
  const anchor = dayOf(reviewAnchor(domain));
  if (anchor === undefined) return undefined;
  return new Date(anchor + intervalDays * DAY_MS).toISOString().slice(0, 10);
}

export interface ReviewState {
  /** The day it comes due. Absent when a date would not parse and it cannot be known. */
  dueOn?: string;
  overdue: boolean;
  /** Whole days past the due date. Zero whenever `overdue` is false. */
  daysOverdue: number;
}

/**
 * Whether an interval has elapsed, as of `today`.
 *
 * Due today is NOT overdue: the interval is elapsed *on* the day, and a rule
 * that fired a day early would be a deadline nobody agreed to.
 *
 * A date that will not parse is not a deadline. The validator has its own rules
 * for an unusable date (`corpus.review-missing`); this function answers only "is
 * it due", and when it cannot know, the honest answer is no.
 */
export function reviewState(domain: Domain, intervalDays: number, today: string): ReviewState {
  const dueOn = reviewDueOn(domain, intervalDays);
  const now = dayOf(today);
  if (dueOn === undefined || now === undefined) return { overdue: false, daysOverdue: 0 };

  const due = dayOf(dueOn);
  if (due === undefined || now <= due) return { dueOn, overdue: false, daysOverdue: 0 };
  return { dueOn, overdue: true, daysOverdue: Math.floor((now - due) / DAY_MS) };
}

export interface ReviewEntry extends ReviewState {
  domain: Domain;
  /** The interval the strictest listing Profession sets (decision 3). */
  intervalDays: number;
  /** The day the clock starts (decision 2). */
  anchor: string;
  /** The Profession that set the pace. Absent for a Domain no Profession lists. */
  pace?: { id: string; name: string };
}

/**
 * Every Domain's clock, as of `today`.
 *
 * This is the one computation the validator's rule and the coverage report both
 * read (decision 6, ADR 0015's rule one level out): the report, the page and the
 * gate describe one asset one way, and a reader never has to work out which of
 * them is lying.
 *
 * A Domain's interval is the STRICTEST among the Professions that list it: the
 * same material can be Tier A for one line of work and Tier C for another, and
 * the high-risk reader is the one whose being wrong hurts, so that reader sets
 * the pace for everyone.
 */
export function reviewLedger(
  index: ProfessionIndex,
  domains: Iterable<Domain>,
  today: string,
): ReviewEntry[] {
  // Which Professions list which Domain, built once rather than scanned per
  // Domain, so the ledger stays linear in the size of the catalogue.
  const listings = new Map<string, Profession[]>();
  for (const profession of index.professions.values()) {
    for (const id of profession.domainIds) {
      const list = listings.get(id);
      if (list === undefined) listings.set(id, [profession]);
      else list.push(profession);
    }
  }

  const entries: ReviewEntry[] = [];
  for (const domain of domains) {
    let intervalDays = BASE_INTERVAL_DAYS;
    let pace: Profession | undefined;
    // A tie leaves the earlier Profession in the catalogue's own order, so the
    // ledger is stable without a second sort key.
    for (const profession of listings.get(domain.id) ?? []) {
      const days = reviewIntervalDays(profession.tier, profession.risk);
      if (pace === undefined || days < intervalDays) {
        intervalDays = days;
        pace = profession;
      }
    }

    entries.push({
      domain,
      intervalDays,
      anchor: reviewAnchor(domain),
      pace: pace === undefined ? undefined : { id: pace.id, name: pace.name },
      ...reviewState(domain, intervalDays, today),
    });
  }

  // Overdue first: the stale rows are the ones a person has to see, and a list
  // that buries them is the silence this ADR exists to remove.
  return entries.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const left = a.dueOn ?? "";
    const right = b.dueOn ?? "";
    if (left !== right) return left < right ? -1 : 1;
    return a.domain.id < b.domain.id ? -1 : a.domain.id > b.domain.id ? 1 : 0;
  });
}
