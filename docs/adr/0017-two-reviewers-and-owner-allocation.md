# The second signature, and who may give it

## The gap

ADR 0012 decision 5 made a promise it could not keep. A high-risk Profession — 护士, 律师 — stays closed "until two independent reviewers sign", and the ADR says in the same breath that this is a description of a door that does not exist yet: "when two-reviewer signing exists, the door opens — until then, closed means closed."

It does not exist, and the reason is a single field. A Domain records exactly one corpus reviewer (`corpusReviewedBy`, ADR 0006/0010), so there is no second place for a second name to go, so `professionStatus` hardcodes the answer — `risk === "high"` returns `closed` whatever is signed, and `profession.high-risk-open` fires the moment a high-risk Profession lists any Domain at all. Two writes of the same fact, one lock. The high-risk half of the catalogue is not slow to open; it is shut, and it has no key.

The Owner has confirmed that other reviewers will exist. That was the missing half of the promise, and with it in hand the lock can be built rather than held shut.

## The decisions

**1. A Domain may carry a second signature, in a pair of optional fields.** `meta.md` gains `secondReviewedBy` and `secondReviewedOn`, alongside the existing `corpusReviewedBy` / `corpusReviewedOn`. The fields are **optional on load**, so the seven Domains that exist today keep loading unchanged: they are single-reviewed, which is what they always were. A Domain is *co-signed* when both fields are present, neither is a placeholder, and the second name is not the first name. This is the one thing the loader refuses to guess at — the pair travels together or not at all, and the validator says so.

**2. Independence is an attestation, and the ADR says so out loud.** Nothing in a file can prove that two names are two people, and nothing ever will: `owner` has had the same property since ADR 0006 and the repository has never pretended otherwise. What a validator *can* decide is that two **different names** are recorded, that neither is a placeholder, and that the pair is complete. That is what the rules check, and the rules must not read as more than they are — the gap between "two names are written here" and "two people read this" is closed by the people, not by the code. A second careless name is not a review; it is a signature, which is all a signature ever was.

**3. A high-risk Profession opens when every Domain it lists is co-signed.** `professionStatus` gains a third input — the set of co-signed Domain ids — and the high-risk branch stops being a constant. It becomes: *every* Domain this Profession lists carries two reviewers, and at least one of them is signed. Every, not any: a Profession listing three Domains where one is co-signed and two are not is a profession still teaching two single-reviewed slices of a subject where being wrong hurts. `closed` therefore stops being a synonym for `high risk` and becomes what it should always have been — **high-risk with no two-reviewer backing**. The parameter defaults to the empty set, so every existing caller and every existing test sees the old answer.

**4. The door reads the status, not the risk.** `highRiskRefusal` — the single rule behind both doors, the board's build path and the direct classroom (ADR 0012 decision 6) — refuses a topic that resolves to a **closed** Profession. An open high-risk line is an open door, by construction rather than by exemption; a single-reviewed one still refuses, with the same sentence it has always given. Nothing about ADR 0011 changes: the direct classroom is still refused at the door, for the same reason.

**5. `profession.high-risk-open` is rewritten, not deleted.** The rule was "a high-risk Profession lists any Domain" — true when the second signature did not exist. It is now "a high-risk Profession lists a Domain that is not co-signed", which is the same claim about the same defect and stays an error for the same reason: a Profession may not claim coverage of a hazardous subject under a signature that does not carry what the ADR promised.

**6. Who may review which line is recorded in the asset.** `professions.md` gains a `reviewers:` list per Profession — the Owner's allocation, written down rather than remembered, because the same key that signs also decides who else may. Its teeth are one rule: a high-risk Profession that lists Domains must name at least two distinct reviewers (`profession.reviewers-insufficient`). Two identical names are one name, so a roster of duplicate lines fails the same check a roster of one does. Ordinary Professions carry a roster too — the person who signs them — and no rule constrains it, because there is nothing to constrain.

**7. The countersignature is an act, and so it is a CLI and never a tool.** `npm run counter-sign -- <domain-id>` adds the second name to a Domain that is already signed. It refuses a name equal to the first reviewer (two names, one person, no second reviewer), refuses a Domain that has none to counter (a first signature is `review-domain`'s job), and refuses to overwrite a second signature that is already there (replacing a signature is not signing one). It is deliberately absent from the MCP server for exactly the reason `review-domain` is: a protocol that could call it would be a protocol that signs.

**8. What this does not decide.** It does not make the platform's reviewers professional, independent in fact, or correct — it records two names and says plainly that it can only check that they differ. It does not open any line by itself: 护士 and 律师 stay closed until someone builds a Domain for them, a person signs it, a second person countersigns it, and both are named in the roster. It does not change the signature gate for ordinary Domains (ADR 0006/0010): one person still signs, and nothing teaches until they do. And it does not touch the acceptance experiment, which runs on Domains and knows nothing about who reviewed them.

## Consequences

- `Domain` gains optional `secondReviewedBy` / `secondReviewedOn`; `hasTwoReviewers(domain)` is the single predicate that decides co-signing, so the loader, the validator, the status computation and both doors read one fact rather than four derivations of it.
- `professionStatus(profession, signedDomainIds, twoReviewerDomainIds)` and `highRiskRefusal(index, topic, reviewers?)` take the co-signed set; both default it to empty, which is what a caller with no disk to read should see — every high-risk line closed.
- The validator gains `corpus.second-review-invalid` (a half-filled pair, a placeholder, or a second name identical to the first) and `profession.reviewers-insufficient`; `validateRepo` computes the co-signed set from the Domains it already loads and passes it to the profession, competency and status rules, so the page and the validator cannot disagree about which lines are open.
- ADR 0012 decision 4's third status is unchanged in shape and new in meaning, and decision 5 is superseded in part: the rule survives, the constant does not.
- The high-risk half of the catalogue acquires a path rather than a wall. It is still a path nobody has walked — no Domain for a nurse exists — and that remains a person's decision (ADR 0006), not this ADR's.

*Consolidates: a-second-signature-is-a-second-field-pair; independence-is-attested-not-proved; the-door-reads-the-status-not-the-risk.*
