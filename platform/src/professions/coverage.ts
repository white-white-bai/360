import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { DOMAINS_DIR } from "../catalog.ts";
import { loadDomain } from "../experts/load.ts";
import { hasTwoReviewers, type Domain } from "../experts/types.ts";
import {
  competenciesOf,
  competencyStatus,
  orderCompetencies,
  professionStatus,
  saysNothingBeyond,
  type Competency,
  type CompetencyIndex,
  type CompetencyStatus,
  type Profession,
  type ProfessionIndex,
  type ProfessionStatus,
  type Signatures,
} from "./load.ts";

/**
 * The coverage ledger (ADR 0015): what one walk of life can learn here, what it
 * still cannot, and what was never going to be here.
 *
 * This is the same computation the entry panel renders, in the same module, so
 * the page and the report cannot disagree — which is the whole reason ADR 0014
 * asked for the report. It is a report and not a gate: "this Profession is
 * still missing four units" is an honest statement about the catalogue's
 * length, not a defect in an asset, so nothing here is a finding.
 */

export interface CompetencyCoverage {
  unit: Competency;
  status: CompetencyStatus;
  /** The units that come first, by NAME — an id is not a route a learner can read. */
  after: string[];
}

export interface CoverageEntry {
  profession: Profession;
  status: ProfessionStatus;
  /** Taught by at least one signed Domain, in prerequisite order. */
  covered: CompetencyCoverage[];
  /** Named, but no signed Domain teaches it yet. */
  planned: CompetencyCoverage[];
  /** What this platform does not teach, per unit — the units that have something to declare. */
  beyond: Array<{ unit: string; because: string[] }>;
  /**
   * How many units answered 「无」 outright. Counted rather than repeated: the
   * page drops these lines too, and a report that listed five `beyond` entries
   * when three of them said "nothing" would overstate the gap.
   */
  beyondNothing: number;
}

/**
 * The signature facts, read off the disk (ADR 0017).
 *
 * Every directory under `domains/` is signed — a draft lives in
 * `domains-draft/` and `review-domain` is the only thing that moves one across
 * (ADR 0010) — so `signed` costs a directory listing. `coSigned` costs a load
 * per Domain, because the second reviewer is a FIELD and only the loader can
 * see it.
 *
 * A Domain that will not load counts as signed and NOT co-signed. That is the
 * failing-closed direction on purpose: a high-risk line is precisely what an
 * unreadable file must not be able to open, and a door that throws on a
 * half-written asset refuses nothing at all. The validator reports why the file
 * would not load; this function's job is to answer the door.
 */
export function signaturesOnDisk(domainsDir: string = DOMAINS_DIR): Signatures {
  // A missing `domains/` is not an error to a caller that is only asking who signed
  // something: no Domains, no signatures. It also fails closed at every door that
  // takes this answer — an unreadable shelf opens nothing.
  if (!existsSync(domainsDir)) return { signed: new Set(), coSigned: new Set() };

  const signed = new Set<string>();
  const coSigned = new Set<string>();
  for (const entry of readdirSync(domainsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    signed.add(entry.name);
    try {
      if (hasTwoReviewers(loadDomain(join(domainsDir, entry.name)))) coSigned.add(entry.name);
    } catch {
      // Signed, single-reviewed. Not a silent failure — the validator names it.
    }
  }
  return { signed, coSigned };
}

/** The co-signed ids among Domains a caller has already loaded — no second read. */
export function coSignedDomainIds(domains: Iterable<Domain>): Set<string> {
  const ids = new Set<string>();
  for (const domain of domains) if (hasTwoReviewers(domain)) ids.add(domain.id);
  return ids;
}

function coverageOf(
  index: CompetencyIndex,
  signedDomainIds: ReadonlySet<string>,
  professionId: string,
): Pick<CoverageEntry, "covered" | "planned" | "beyond" | "beyondNothing"> {
  const units = orderCompetencies(competenciesOf(index, professionId));
  const names = new Map(units.map((unit) => [unit.id, unit.name]));

  const counted: CompetencyCoverage[] = units.map((unit) => ({
    unit,
    status: competencyStatus(unit, signedDomainIds),
    after: unit.requires.map((id) => names.get(id) ?? id),
  }));

  const beyond = counted.map((entry) => ({
    unit: entry.unit.name,
    because: entry.unit.beyond.filter((line) => !saysNothingBeyond(line)),
  }));

  return {
    covered: counted.filter((entry) => entry.status === "covered"),
    planned: counted.filter((entry) => entry.status === "planned"),
    beyond: beyond.filter((entry) => entry.because.length > 0),
    beyondNothing: beyond.filter((entry) => entry.because.length === 0).length,
  };
}

/** One Profession's map, both halves. */
export function capabilityMap(
  index: ProfessionIndex,
  competencies: CompetencyIndex,
  signatures: Signatures,
  professionId: string,
): CoverageEntry | undefined {
  const profession = index.professions.get(professionId);
  if (profession === undefined) return undefined;
  return {
    profession,
    status: professionStatus(profession, signatures.signed, signatures.coSigned),
    // Coverage is about whether a signed Domain TEACHES a unit, so the co-signed
    // set plays no part here — a single signature is enough to teach.
    ...coverageOf(competencies, signatures.signed, professionId),
  };
}

/** Every Profession, in the catalogue's own order — the table `npm run coverage` prints. */
export function coverageLedger(
  index: ProfessionIndex,
  competencies: CompetencyIndex,
  signatures: Signatures,
): CoverageEntry[] {
  return [...index.professions.values()].map((profession) => ({
    profession,
    status: professionStatus(profession, signatures.signed, signatures.coSigned),
    ...coverageOf(competencies, signatures.signed, profession.id),
  }));
}
