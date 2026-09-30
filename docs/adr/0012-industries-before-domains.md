# The entry is industries, and an industry says honestly how much of it can be taught

## The gap

The Catalogue holds seven Domains, all software topics. The expansion goal is三百六十行 — every walk of life. But ADR 0002 and the builder's planner both say "an industry is not a Domain", and ADR 0006's five selection criteria (tractable corpus, one session, misconception density, decidable checks, drawable board) are written for text-shaped knowledge. Nothing in the repo says how an industry becomes Domains, or what to do about the industries where those criteria cannot all hold: the electrician whose skill lives in hands, the nurse where teaching wrong has consequences.

## The decisions

**1. Three layers, one of them deferred.** *Profession* → *Competency* → *Domain*. A Profession is the entry unit the learner picks; a Domain still teaches one boundaried slice. The middle layer — Competency, the must-know-and-be-able-to-apply units linked by prerequisites — is recorded here but NOT implemented: it is needed only once a Profession holds more than one Domain, and inventing it now would be machinery without a consumer.

**2. The skeleton is the official classification.** 《中华人民共和国职业分类大典》(2022年版: 8 大类, 1639 职业) supplies the category structure, because it is public, stable and citable. 三百六十行 names enter as *aliases*, not as taxonomy. Only the professions the platform can actually say something about are seeded — the file's length is again the honest statement of what can be taught, so a skeleton of categories with a pilot batch of professions, not a copy of all 1639.

**3. Two independent axes on every Profession.** *Tier* (how much can be taught): A — text-verifiable knowledge, full apparatus; B — standards-and-diagrams knowledge, apparatus plus the honest note "does not replace practice"; C — embodied skill, the cognitive layer only, boundary stated. *Risk*: ordinary, or high (teaching wrong harms people, property or rights). Tier answers "how much"; risk answers "what happens if we are wrong". Neither implies the other.

**4. Status is computed, never stored.** A Profession is *open* when at least one of its Domains is signed, *planned* when it has none, and *closed* when it is high-risk. Nothing in the data file says "we teach this" — that claim is derived from signatures, the same gate as everything else.

**5. High-risk stays closed until two independent reviewers sign.** ADR 0004's rule — no actor verifies its own output — extended: a high-risk Profession may not list any Domain while every Domain records exactly one reviewer. The validator enforces this (`profession.high-risk-open`), and both doors (the board's build path and the direct classroom) refuse a topic that resolves to a closed Profession. This is deliberately a hard refusal, not a disclaimer: for high-risk subjects an unverified answer is the product, and a label does not change that. When two-reviewer signing exists, the door opens — until then, closed means closed.

**6. The direct classroom survives, behind the same door.** ADR 0011 stands: it is the exploration path for long-tail topics, unverified and labelled. It is NOT exempt from decision 5 — a closed Profession is refused there too. What it cannot do is enforce per-reply risk, so the gate sits at the door, where the topic is known.

**7. Near-duplicates are named, not deleted.** Four signed Domains share most of their sources. The validator now warns (`domain.overlap`) with the shared-source count, but deletion stays a person's decision with the names in front of them — the same rule ADR 0010 gives a signature over drafts. Signed Domains are not swept automatically.

**8. Junk sources fail at fetch time, not at review.** A fetch that lands on an error page (region-blocked, unavailable, captcha) is refused by the fetcher itself, and the validator re-checks every recorded source (`corpus.source-unusable`, `corpus.source-redirected`). The two existing Domains that carried a region-block page as a source are cleaned: the page backed no passage, so removing it changes nothing that was taught.

## Consequences

- `professions/professions.md` holds categories and Professions in the existing section grammar; `loadProfessions` parses it, `professionOptions` computes status from signed Domains, `/options` carries it to the page, and the entry panel shows it grouped by category with each Profession's status visible.
- A learner clicking an open Profession starts its first Domain; a planned one types the profession into the topic box (the builder's door); a closed one is inert and says why.
- The validator gains profession rules: unknown category, unknown or unsigned Domain, missing boundary, invalid tier/risk, and high-risk-open. A Domain listed by no Profession warns (`domain.unlisted`) — coverage that the directory cannot show is coverage that quietly decays.
- Tier C Profains carry their boundary in the data, so the "we only teach the thinking, not the hands" claim is checkable rather than remembered.
- The acceptance experiment is untouched: it runs on Domains, and a Profession is a door to Domains, not a Domain itself.
