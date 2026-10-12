/**
 * Anything that looks like an unfilled field rather than a decision.
 *
 * Kept in one place so a placeholder cannot be recognised in one rule and missed
 * in another. It lives in `util/` rather than in the validator because it is no
 * longer only the validator's business: whether a Domain's SECOND reviewer counts
 * (ADR 0017) is decided by `hasTwoReviewers`, which the status computation, the
 * coverage report and both doors read — and a `secondReviewedBy: TODO` that one
 * of them treated as a signature while another did not would be exactly the
 * disagreement this module exists to prevent.
 */
const PLACEHOLDER = /REPLACE|TODO|TBD|UNASSIGNED|CHANGEME|FIXME|XXX/i;

/** True when a field is absent, blank, or still the scaffold text it was written as. */
export function isPlaceholder(value: string | undefined): boolean {
  return value === undefined || value.trim() === "" || PLACEHOLDER.test(value);
}
