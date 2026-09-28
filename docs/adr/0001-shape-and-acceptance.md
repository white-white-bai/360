# Shape: a kernel and a protocol before an application, accepted by beating a baseline

## The shape

The platform is ultimately a standalone application — a classroom UI, an orchestrator service, and a library of expert-role definitions. v1 ships only the reusable kernel: the orchestration core plus the blackboard event protocol, with no product UI. The UI is a later consumer of both.

The target experience (a live blackboard, several personas on screen, the learner interrupting mid-explanation) needs a GUI and an event channel, which a pure-prompt implementation cannot provide — a skill is a prompt: no canvas, no concurrency, no event bus. So the application is the destination. But building the UI first would spend the whole budget on rendering before the one open question — whether the teaching content is actually any good — has been answered.

## How v1 is accepted

Replaying the event stream and watching the loop run is a **smoke test, not a result**. It shows the machine runs; it says nothing about whether it teaches.

Acceptance is an experiment comparing one Assertion List under two conditions:

- **Baseline** — one strong explainer plus the same terminal Understanding Check. No probes, no grounding verification, no Challenger.
- **Apparatus** — the full stack.

The primary measure is the terminal check. The secondary measures matter more than they look: retention a day later, transfer to a new situation, and **the gap between the learner's self-assessment and their measured result** — the quantified form of the illusion of understanding, and the number this product should be judged on.

## Considered options

- **The application first.** Rejected for sequencing, not shape: it front-loads rendering before the teaching is validated.
- **Express the platform entirely as harness skills.** Runs today at near-zero cost but cannot reach the target experience. Recorded because this repository is itself a skills library, so this option will come back.
- **Accept v1 by replaying the loop.** Rejected: a smoke test masquerading as a result.

## Consequences

- **Any piece of the apparatus that shows no measurable difference against the baseline should be deleted.** This is the only mechanism in the design that resists unbounded accretion: every concept is defensible on its own, and the sum of defensible concepts is an unvalidated monolith.
- v1's scope includes the ablated path — by far the cheaper of the two, and it must exist regardless.
- The kernel is validated through a replayable event stream plus a minimal renderer. The experience is inherently visual, so "no UI" also means "no way to judge the experience" unless the stream can be replayed.
- The existing `.commandcode/skills` collection is an asset library for expert roles, not the delivery vehicle. Two-harness compatibility is not on the critical path.

*Consolidates: kernel-and-protocol-before-UI; beat-the-baseline-not-replay.*
