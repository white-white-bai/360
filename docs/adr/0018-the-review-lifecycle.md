# The review lifecycle: how long a signature stays good

## The gap

ADR 0006 and ADR 0010 built the gate: nothing teaches without a person's signature, and `corpusReviewedOn` records the day they gave it. Nothing records **how long that signature stays good**.

A signature is a statement about a corpus *at a date* — these passages say this, and I checked the documents they cite. The documents are not frozen. RFCs are superseded, national standards are revised, a page that answered in 2024 404s in 2027, and a Domain built from a vendor's docs describes whatever the vendor believed that quarter. Seven Domains and one Owner can hold that in mind. One thousand six hundred and thirty-nine Professions cannot, and the failure is not dramatic: a Domain reviewed in 2024 keeps rendering exactly as it did, and nothing anywhere says the ground moved.

ADR 0017 added a second reviewer and, with it, a second date. That makes the question sharper rather than easier — a Domain read again in 2026 is not overdue because its first signature is from 2024 — so the computation has an anchor, and it is no longer obvious which field it is.

## The decisions

**1. The interval is two dials, and the shorter answer wins.** Tier says how much of a Profession can be taught here; Risk says what happens if the platform teaches it wrong. Those are two different questions, and each has its own opinion about how fast the ground moves under a Domain:

```
TIER_DAYS:   A 365   B 365   C 730
RISK_DAYS:   ordinary 730     high 90
```

An ordinary line is re-read within a year — within two, if it is Tier C, where the platform claims only the cognitive layer and leans on the most general material it has. A high-risk line is re-read within a quarter whatever its Tier: the failure this platform exists to prevent is asserting something confidently off a source that has since moved.

The composition rule is `min`, not a lookup grid. The two dials are answered separately, so a grid would have to be re-decided every time either one gains a value; a minimum is a rule that survives that. It is also the conservative direction — the stricter dial sets the pace, which is the one whose failure is the one that matters.

**2. The anchor is the most recent read, and a second signature is a read.** A Domain's clock starts at `max(corpusReviewedOn, secondReviewedOn)`. ADR 0017 made the second reviewer a field rather than a gesture; a Domain that someone re-read in 2026 is not stale because someone else first signed it in 2024. Taking the maximum is the whole reason this is a computation rather than a comparison of one field to today.

**3. A Domain's interval is the strictest among the Professions that list it.** A Domain can be taught under more than one line of work, and the lines can disagree: the same material is Tier A for one Profession and Tier C for another. The high-risk reader is the one whose being wrong hurts, so that reader sets the pace for everyone.

A Domain no Profession lists gets the base rate — the interval a Tier A ordinary line gets, 365 days, which is also the strictest an ordinary line can be. This is the one place this policy does not fail closed, and the reason is that there is nothing to fail closed *against*: an unclaimed Domain has no consumer to hurt, and `domain.unlisted` already names it as unclaimed. Two rules saying "nobody depends on this" would not make it twice as true.

**4. Overdue is a warning, never an error, and it closes nothing.** `corpus.review-overdue` is a warning, so `npm run validate` still exits zero on it. A validator that failed the build because nobody had re-read a Domain since last spring would be switched off inside a week — and would then stop reporting the errors it shares a run with. The repository's errors/warnings line (see `validate/types.ts`) is exactly for this: an error is a defect in an asset, and this is an open question about one.

It does **not** change `professionStatus` and does **not** close a door. Status is computed from signatures (ADR 0012/0017), and a status that also read the system clock would change at midnight, be untestable without freezing time, and let the page and `npm run coverage` disagree across a timezone. Expiry is a **maintenance signal**, not a coverage claim: it says the reading is old, not that the reading was wrong, and not that the material has stopped being true. Whether stale material should stop being taught is a person's decision — the one ADR 0006 has always reserved — and this ADR deliberately does not take it.

**5. `today` is an argument, not a call to the clock.** `reviewLedger(index, domains, today)` and `ValidateOptions.today` take the date; the CLIs pass the real one at the edge. This is the same shape as `counterSignDomain`'s `date` (ADR 0017), for the same reason: a rule whose only test is "freeze the system clock and hope" is a rule that gets tested once and then never again.

**6. The report carries the same judgement, by the same function.** `npm run coverage` gains a 待复审 section, computed by the `reviewLedger` the validator's rule also reads — ADR 0015's rule one level out: the page, the report and the validator describe one asset one way, and a reader never has to work out which of them is lying. The section prints whether or not a Profession id was passed on the command line, because the signal is about the shelf rather than about one line of work.

**7. What this does not decide.** It does not schedule anything or notify anyone; there is no scheduler here and this ADR does not add one, and a warning that a person reads when they run the validator is the entire delivery mechanism. It does not version or archive the sources a Domain was built from, so it can say *that* an interval elapsed and never *what* changed. It does not claim the interval is the truth about any source: a source can rot on day one and stay correct for a decade, and nothing has told the platform about either. And it does not close a door, as decision 4 says out loud. What it removes is the silence.

## Consequences

- New module `src/professions/review.ts` — `TIER_DAYS`, `RISK_DAYS`, `reviewIntervalDays(tier, risk)`, `reviewDueOn(domain, intervalDays)`, and `reviewLedger(index, domains, today)`. No new runtime dependency: the date arithmetic is `Date.parse` on an ISO date plus whole days, and back.
- `validateDomain` gains the Domain's interval as a parameter — passed as the whole `reviewLedger` entry, so the rule reads the same computation the report prints rather than repeating it — and with it the warning `corpus.review-overdue`. It fires only when the catalogue loaded, because a Domain's pace comes from the Professions that list it. `validateDraft` passes nothing, and therefore never fires it: a draft has no Profession to set its pace, and a clock on an unsigned draft would be a deadline for work that has not been accepted.
- `ValidateOptions` gains `today`; `run-validate.ts` is unchanged, because warnings already do not move the exit code.
- `run-coverage.ts` prints the 待复审 section; `CONTEXT.md` gains **Review Interval**.
- Nothing about ADR 0017 is revised: no field, no predicate, no status, no door changes. A co-signed Domain ages the same way a single-reviewed one does, off the more recent of its two dates.

*Consolidates: the-interval-is-two-dials-and-the-shorter-wins; a-second-signature-is-also-a-read; expiry-is-a-maintenance-signal-not-a-coverage-claim.*
