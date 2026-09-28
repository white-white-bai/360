/**
 * Validation findings (ADR 0006).
 *
 * The distinction that matters is `error` versus `warning`, and it is not about
 * importance — it is about *knowability*. An error is something the validator can
 * decide from the assets alone. A warning is something it can only raise, because
 * the judgement is not in the files.
 *
 * That line is why ADR 0006 makes the validator a precondition for the ablation
 * experiment: if the material can be wrong in ways nothing reports, then a failed
 * experiment cannot be distinguished from a mis-configured one, and the experiment
 * proves nothing either way.
 */
export type Severity = "error" | "warning";

export interface Finding {
  severity: Severity;
  /** Stable identifier, so a finding can be referred to and later waived explicitly. */
  code: string;
  /** What the finding is about — a file, or an asset by id. */
  where: string;
  message: string;
  /** The concrete next action, when there is one. */
  fix?: string;
}

export interface ValidationReport {
  findings: Finding[];
  errors: number;
  warnings: number;
  /** True only when there are no errors. Warnings never gate. */
  ok: boolean;
}
