# The platform teaches the cognitive layer, and the capability map says where the rest is learned

## The gap

The mission is 三百六十行 — every walk of life learns a professional skill here. The platform cannot say that sentence, and has never said which part of it *is* true.

Every mechanism in the repository points the same way: a claim about the world must trace to a passage in a signed corpus (ADR 0004), an out-of-corpus question must be refused, a check must be decidable rather than argued (ADR 0006). That machinery teaches **what is true and checkable**. It cannot teach a hand to hold a knife, cannot observe a trainee's stitches, and cannot be accountable for judgement exercised under real stakes. What it does teach is real; it is also not "专业技能" in the sense the mission sentence uses.

ADR 0012 already saw this per Profession — Tier B carries "does not replace practice", Tier C says "the cognitive layer only" — but a per-asset footnote is not a product claim. A learner reading 中式烹调师 today sees a tier, a boundary sentence, and nothing else. Nothing tells them what part of the trade this *does* cover, and nothing tells them where the part it does not cover is learned. **A boundary with no map reads as a refusal**, and a refusal that lists nothing is indistinguishable from having nothing to say.

## The decisions

**1. The claim is the cognitive layer.** What the platform offers is verifiable, examinable knowledge: statements about the world that trace to a source, questions whose answers are decidable, misconceptions that can be named and refuted. Embodied skill, supervised practice and professional judgement under real stakes are outside the claim. This is the product's **public statement**, made once for the whole platform — ADR 0012's tier boundaries are instances of it, not substitutes for it.

**2. Every open Profession carries a Capability Map.** The map has two halves and both are shown:

- **What is learned here** — Competency units, each backed by at least one signed Domain, linked by prerequisites so the learner sees an order rather than a list.
- **What is not taught here, and where it is learned** — named, per competency: which parts this platform cannot teach and what kind of thing does teach them (a supervised apprenticeship, a licensing body, a standard that must be held in hand).

The second half is what makes it a map rather than a syllabus, and it is the half this ADR exists to make mandatory. It is materialized from the **Competency** layer, which ADR 0012 decision 1 recorded and deferred with the reasoning "needed only once a Profession holds more than one Domain". That condition has been met by the platform's own data — the one open Profession holds seven Domains with no orchestration between them — so the layer lands in the decision that follows this one. **This ADR fixes the claim and the shape of the map; it builds no mechanism**, so that the mechanism has something to be judged against.

**3. The Catalogue's length stays the honest statement.** ADR 0002 and ADR 0012 are unchanged: a Profession with no signed Domain is not shown as learnable, and the Capability Map does not soften that. The difference is that the map's empty half is now **displayed rather than hidden**: a Profession whose entire map is "none of this is here yet" says exactly that, which is an honest answer, where a blank row is not.

## Consequences

- `README.md` carries the claim in its status section; `CONTEXT.md` gains **Competency** and **Capability Map** (the code and the docs must use those words).
- The board's entry panel shows an open Profession's map. A planned Profession shows the map's untaught half only, which is the truthful content of "planned".
- A coverage report (`npm run coverage`) answers the question this whole plan is about — *what is still missing for this walk of life* — from the same assets the map is drawn from, so the page and the report cannot disagree.
- **What this does not decide.** How competence is *assessed*: the platform has no instrument for hands, and this ADR does not pretend to build one — assessment beyond the Understanding Check is out of scope by decision 1, not by omission. Nor does it decide which of the 1639 professions is built next: ADR 0006 stands, a person signs, and a map only ever says what is missing.
- The acceptance experiment (ADR 0001) is untouched: this decision is about the claim's scope, not about whether the apparatus teaches.

*Consolidates: the-claim-is-the-cognitive-layer; every-profession-carries-a-capability-map.*
