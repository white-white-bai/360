# Three axes, a shared library, plain-text authoring with a validator, and how Domains are chosen

## An expert is three independent axes

An expert is configured as **Persona**, **Domain** and **Style** — independently swappable — rather than as one prompt. Routing an expert into a session (Lead Explainer, Challenger) is a separate thing: a **Position**, not a kind of expert.

The obvious path is one prompt per expert, and it is wrong for two reasons, the second of which is serious:

- **The retry rule needs Style to be separable.** With one fused prompt, "explain it differently" can only be done by swapping the expert, which also changes what it knows. That is not a retry; it is a different teacher.
- **Domain is the only auditable anti-confabulation surface.** In a teaching product a wrong statement is worse than none — the learner is there precisely because they cannot tell. A knowledge boundary buried inside a prompt cannot be audited: there is no way to answer "what was this expert authorized to teach?"

Persona is cheap and Style is separable, so both should be numerous; Domain is expensive and few. They are one config shape, but not the same kind of asset.

## Personas and Styles are one shared library

They are product-wide assets in a single **Library**, reused across Domains, with an Owner of their own. v1 has no per-Domain override.

Reusability is not a convenience here, it is the precondition for Persona being an axis at all: if each Domain carried its own, twenty Domains would invent twenty near-identical voices, and Persona would have quietly collapsed back into being part of Domain. Consistency is also an asset in its own right — an explainer that sounds recognisably like the same product across Domains reads as one product rather than a patchwork.

**Two owner roles fall out of the axes, and they are different jobs:** the Domain Owner owns whether it is *correct*; the Library Owner owns whether it is *well delivered*. Rights and accountability stay coupled, so neither library can be left unowned.

Per-Domain overrides are out of v1: they introduce precedence rules, merge semantics and stale-override detection, all before it is known whether the shared set is sufficient.

## Authoring is files plus one validator

Domain, Persona and Style are plain-text assets in the repository, reviewed by pull request. One validator sits alongside them. There is no admin UI.

**The validator is a precondition for acceptance, not a nicety.** If configuration can be wrong — a passage with no provenance, a Term Glossary missing a term, a Misconception contradicting the corpus — the ablation experiment fails, and there is no way to tell whether **the teaching design does not work** or **the material was mis-configured**. Without it, the headline experiment is uninterpretable.

Minimum checks, each traceable to a decision:

- every corpus passage carries publicly checkable provenance
- every Grounded Assertion traces to a passage
- the Term Glossary covers every term used in the corpus, with no conflicting renderings
- every Misconception is reachable by some Probe or Understanding Check diagnosis — otherwise the catalogue accumulates wrong models that nothing will ever refute

Why no admin UI, beyond the shape decision? Configuration is low-frequency, needs review, and needs diffs. It belongs in version control and pull requests, not in a form. An admin UI would also make "who changed which piece of knowledge, when" hard to trace, breaking the coupling of rights and accountability.

Because the assets are plain text they are greppable, reviewable and reusable by other harnesses — which finally makes the existing skills repository a genuine asset library rather than a parallel system.

## How Domains are chosen

Domain selection is gated by five criteria:

| Criterion | From |
|---|---|
| **Corpus tractability** — public authoritative sources, a clear boundary, small | correctness (0004) |
| **Fits one session** — small enough for a single Assertion List | entry and session (0002) |
| **High Misconception density** — many named, cataloguable wrong models | correctness (0004) |
| **Yields objectively decidable transfer checks** — computable, not judgement | correctness (0004) |
| **Gives the blackboard something to draw** — v1 has to exercise the protocol | shape (0001) |

The first Domain is **time stamps, time zones and daylight saving**: a single stable authority (IANA tzdb, RFC 3339, RFC 9557); famously misconceived — "UTC is GMT", "a timestamp carries its own zone", "DST can be ignored"; its checks are computable exactly rather than argued about; and it draws well — timelines, zone bands, DST jumps.

It also has something the other candidates lack: it is **self-demonstrating**. Telling someone they do not actually understand time zones, then proving it with a check they cannot argue with, is the product's entire value proposition delivered in one sitting.

Rejected: **HTTP caching (RFC 9111)** — passes every criterion but draws less richly; **PostgreSQL indexes** — draws well and is boundaried, but its transfer check is judgement ("would this index help?") rather than computation, which weakens the primary measure in 0001.

These criteria gate **every** Domain, not just the first.

*Consolidates: experts-are-three-axes; persona-and-style-shared-library; authoring-is-files-plus-a-validator; first-domain-and-selection-criteria.*
