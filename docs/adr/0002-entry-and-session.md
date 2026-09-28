# Entry is a catalogue, a session is one Assertion List, and sessions resume

## Entry

A learner starts by choosing from the **Catalogue** — the Domains that exist. Free-text entry is not a v1 entry point, and neither is routing free text to the nearest Domain.

An open entry point destroys grounding: most questions would land outside every corpus, leaving two bad options — drop traceability and become a general chatbot, or make "I do not know" the first thing the learner hears. A first experience of refusal does not read as honesty; it reads as uselessness. Routing looks like a compromise but front-loads the hardest problem into v1, and its failure mode is worse than refusal: a mis-routed question produces a confident, off-target explanation the learner has no way to detect.

This restricts only how a session **starts**. Inside a session the learner may ask whatever they like.

**The Catalogue's length is an honest statement of what the platform can teach.**

## What one session is

A session delivers exactly one **Assertion List**, and "class is over" means the list has been delivered and its checks have passed — or the learner stops. v1 has no course, no curriculum, no multi-session unit.

A whole Domain per session would force Domains to be either too large to sit through or too small to be worth opening. A pre-sliced unit beneath the Domain requires a syllabus, and a syllabus is *curriculum design* — another unvalidated surface, sitting a layer above an explanation whose effectiveness has not been measured.

**Domain granularity is bounded from above by "does this fit in one session?"** Every Domain added has to pass that question first. This is one of several independent reasons an *industry* is not a Domain.

## Lifetime

A session is persisted and resumable: the learner may leave and return, and blackboard state, progress and recorded misconceptions come back with them. Replay of *completed* sessions is not promised in v1.

Event sourcing already makes blackboard state a replayable sequence, so persistence costs almost no additional design — discarding it means deliberately throwing away what the architecture hands over for free. And interruption is normal: an explanation may run ten minutes. Destroying a half-finished class on disconnect contradicts the very thing the product claims to be.

Replay of finished sessions is withheld because it immediately raises questions with no known answers — does re-watching require re-taking Probes, is a re-watch a new session? Those depend on usage nobody has seen yet.

**The record is sensitive.** It contains the learner's misconceptions and their own words — in effect, a file of what they do not know. Choosing resumability is simultaneously a commitment: **deletion must exist and be verifiable**, as a design requirement now, not a feature added after an incident.

**Stated premise: one session has exactly one Learner.** Multi-learner sessions would invalidate Probe, Understanding Check and Challenger targeting — whose misconception, whose pass? — and are out of scope.

*Consolidates: catalogue-entry-not-open-question; session-is-one-assertion-list; sessions-resumable-and-sensitive.*
