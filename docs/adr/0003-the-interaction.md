# One explainer and an on-demand challenger, mandatory participation, verification in two tiers

## One explainer, one challenger

The product was described as a classroom in which several expert agents discuss the topic in front of the learner. We are deliberately not building that. One **Lead Explainer** carries the explanation on a single thread. A **Challenger** is summoned only at points where the learner is likely forming a misconception, and its job is narrow: surface the wrong intuition, then refute it.

Multi-agent discussion adds exactly two pedagogical mechanisms — cognitive conflict, and coverage of sub-problems one expert would miss. Everything else it produces is noise. Ambient disagreement raises the learner's cognitive load, which is the opposite of what a teaching product wants, and it costs N× latency and N× money for one turn of teaching. Unconstrained, it degenerates into a single model wearing five accents: the learner cannot tell the difference, the bill can. The mechanism that drives learning is *targeted* conflict — "you think it is X, but it is Y" — not conversation volume.

Rejected: **a free multi-agent panel** (no one could name a sentence it produced that a strong single explainer could not); **a single explainer with no challenger** (throws away the one mechanism worth keeping, and a fluent explanation leaves the learner *feeling* they understood).

## One loop

```
choose a direction → explain (emitting blackboard events) → understanding check
  → if it fails: summon the challenger to surface and refute the wrong intuition
  → explain again
```

Two properties are deliberate and easy to erode:

- **The check gates the challenge.** The Challenger is not ambient and not scheduled. It fires because a specific check failed. There are exactly two triggers: a failed Probe, or a failed Understanding Check.
- **A retry must change the explanation, not repeat it.** Re-running the same words cannot work — the learner already did not follow them. A retry changes *something*: the analogy, the entry point, the level of abstraction, the worked example. "Say it again" is not a retry.

## Verification in two tiers

- **Probe** — inline, frequent, ungraded. Typically "say that last part back in your own words." It costs almost nothing, and it has teaching value in itself: it turns a hidden misconception into an explicit one.
- **Understanding Check** — terminal, strict, independently authored, objectively decidable where possible. It decides whether the session is over, and it must be a transfer task, not a restatement.

Why not only the terminal check? If the learner's model breaks at assertion 2 and nothing notices until the end, assertions 3 through 8 are built on the error and **reinforce** it, since later material coheres around a wrong premise once assumed. Late discovery is the expensive failure.

Why not check after every assertion? A check is not free — it carries independent authoring and grading — so per-assertion checking turns one lesson into eight exams and destroys the flow a classroom depends on.

The two kinds must never be conflated, in the UI or the data model. A Probe scores nothing and blocks nothing; a Check gates the end of the session.

## Participation is mandatory

The learner cannot skip a Probe or the Check. By the platform's own definition, an interaction that can be skipped past its check is not teaching, it is explaining. A skip-everything mode ships a feature with **no success signal at all** — the mirror image of a meaningless check making a broken product look successful; here an absent check makes a working one unmeasurable.

Why not two modes, "I want to learn" versus "just show me"? The second cannot be evaluated, so half the build cost goes to a path nobody can judge, and "what is this product actually teaching?" is deferred forever.

The right response to friction is not to make participation optional, but to make it cheap: a Probe is one sentence and is not graded; restating in one's own words is the cheapest known learning action (the generation effect); only the terminal check asks for an answer, and it asks one question.

So **"idiot-proof" translates into engineering as: Style compresses the explanation's entry bar; participation stays non-optional.** That is why they are separate axes.

**The target learner is someone willing to spend one sentence per assertion in order to actually learn.** A learner who wants to remain entirely passive is served by a video. Recorded because "let users skip" will be re-proposed as a conversion optimisation.

*Consolidates: lead-explainer-plus-challenger; one-teaching-loop; two-tier-probe-and-check; participation-is-mandatory.*
