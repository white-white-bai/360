# Competency is the middle layer, and the coverage ledger is what it is for

## The gap

ADR 0014 fixed the claim and the shape of the map: the platform teaches the cognitive layer, and every open Profession carries a Capability Map whose second half says what is *not* taught here and where it is learned. It also said, deliberately, that it "builds no mechanism", so that the mechanism would have something to be judged against.

This is that mechanism, and the reason it cannot wait any longer is written in the decision it fills in. ADR 0012 recorded three layers — *Profession* → *Competency* → *Domain* — and deferred the middle one, "needed only once a Profession holds more than one Domain". `software-developer` holds seven signed Domains. The condition ADR 0012 named has been met by this repository's own data, and the consequence is visible at entry: the learner sees seven Domain names in a flat list. Nothing says which comes first. Nothing says what is missing. And the list would look exactly the same whether the Profession were five units from complete or lucky to have any at all.

## The decisions

**1. The Competency is implemented, and it is an asset.** `professions/competencies.md`, `kind: competency` sections in the section grammar every other knowledge asset uses. A unit carries `profession` (whose unit it is), `name`, `boundary` (what this platform will not claim here), `domains` (the Domains that teach it), `requires` (the units that come before it) and `beyond` (**what this platform does not teach for this unit, and what kind of thing does**).

**2. Status is still computed, never stored.** A Competency is *covered* when at least one Domain that teaches it is signed, and *planned* otherwise — ADR 0012's rule for a Profession, applied one layer down. The Competency layer does **not** become a second door: naming ten units for an industry cannot open it, because a Profession still opens only against a signature.

**3. `beyond` is the half ADR 0014 exists to make mandatory.** Every unit answers "and what teaches the rest". A unit whose answer is "无——这一单元完全落在认知层" has answered; a unit that says nothing has not, and the validator reports it (`competency.missing-beyond`). The answer is displayed on the entry panel, not tucked into a tooltip: a map whose second half must be hovered to be read is a syllabus with better manners.

**4. The order is stated, not implied.** `requires` links the units, so the learner sees a route rather than a list. The validator refuses an unknown prerequisite and refuses a cycle. It also warns when a Profession's units declare no prerequisites at all (`competency.orphan`) — because then every unit *is* an orphan and the learner is reading a list, which is the thing ADR 0014's "an order rather than a list" forbids. A unit that legitimately comes before nothing — a foundation — does not warn; the warning fires on maps with no edges, not on maps with a wide frontier.

**5. The coverage ledger answers the question this whole line of work is about.** `npm run coverage` prints, per Profession, what is covered, what is planned, and what is beyond — from the same assets the entry panel draws from, so the page and the report cannot disagree. It is a report, not a gate: it exits zero, because "this walk of life is still missing four units" is an honest statement about the catalogue's length, not a defect in an asset.

**6. What this does not decide.** No assessment beyond the Understanding Check — ADR 0014 decision 1 said so, and a Competency names what must be known without giving the platform an instrument for hands. No auto-filling of the other 1638 professions: a paper in the ledger is a person's decision (ADR 0006). And the Catalogue's length is unchanged (ADR 0002/0012) — a Profession with no signed Domain is still *planned* however many Competencies it names, and the ledger's empty half is displayed rather than hidden.

## Consequences

- `CONTEXT.md` already carries **Competency** and **Capability Map** (ADR 0014); the code now uses those words, and the coverage report is the mechanism that ADR 0014 promised would answer *what is still missing for this walk of life*.
- The entry panel shows the selected Profession's map — both halves. A Profession whose map is empty says exactly that, rather than showing a blank row (ADR 0014 decision 3). A planned Profession shows its untaught half, which is the truthful content of "planned".
- ADR 0012 decision 1 is annotated `Superseded by ADR 0015`: the deferral is spent and the layer is landed. The rest of ADR 0012 — tier, risk, computed status, the two-reviewer rule, the hard refusal at both doors — stands unchanged.
- The new rules are written against fields the loader leaves **optional**, so that each can actually fire. This is not pedantry about style: `profession.missing-boundary` tests a condition the loader already refuses, so it reads like a safeguard and is not one. The same should eventually be decided for it; this ADR does not, because loosening a loader's guarantee is a different decision from adding a layer.

*Consolidates: competency-is-the-middle-layer; the-coverage-ledger-shows-what-is-missing.*
