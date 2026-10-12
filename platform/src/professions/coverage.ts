import { readdirSync } from "node:fs";

import { DOMAINS_DIR } from "../catalog.ts";
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
 * Every directory under `domains/` is signed — a draft lives in
 * `domains-draft/` and `review-domain` is the only thing that moves one across
 * (ADR 0010). So the directory listing IS the set of signatures, computed the
 * same way `professionStatus` gets it anywhere else.
 */
export function signedDomainIdsOnDisk(domainsDir: string = DOMAINS_DIR): Set<string> {
  return new Set(
    readdirSync(domainsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
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
  signedDomainIds: ReadonlySet<string>,
  professionId: string,
): CoverageEntry | undefined {
  const profession = index.professions.get(professionId);
  if (profession === undefined) return undefined;
  return {
    profession,
    status: professionStatus(profession, signedDomainIds),
    ...coverageOf(competencies, signedDomainIds, professionId),
  };
}

/** Every Profession, in the catalogue's own order — the table `npm run coverage` prints. */
export function coverageLedger(
  index: ProfessionIndex,
  competencies: CompetencyIndex,
  signedDomainIds: ReadonlySet<string>,
): CoverageEntry[] {
  return [...index.professions.values()].map((profession) => ({
    profession,
    status: professionStatus(profession, signedDomainIds),
    ...coverageOf(competencies, signedDomainIds, profession.id),
  }));
}
