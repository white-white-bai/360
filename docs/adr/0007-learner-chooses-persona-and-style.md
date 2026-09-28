# The learner picks the Persona and Style at entry; no Domain declares a default

The Catalogue offers, for a chosen Domain, a choice of Persona and Style. Nothing in `domains/*/meta.md` names a default.

Why: ADR 0006 keeps Persona and Style in a shared library so that they are separable and reusable across Domains. A per-Domain default would quietly re-fuse them to the Domain — the same collapse ADR 0004 rejected when it refused one prompt per expert. If the Domain decides how it is taught, Style stops being an axis and becomes a field the Domain owns.

Second, the preference is real information and the platform has no other way to get it. Two learners facing the same Domain may want the analogy-heavy walkthrough or the terse one, and there is no ground truth to guess from. A default would be the platform guessing on their behalf and never finding out it guessed wrong.

## Consequences

- **Entry now has two steps**: pick a Domain, then pick how it is taught. The Catalogue's length remains the honest statement of what can be taught (ADR 0010); the second step is honest about the fact that the same material can be taught well in different ways.
- **The library has to offer a choice.** One Persona makes the choice vacuous, so the validator warns below two and errors at zero — the assets are now checked against an entry design, not just against each other.
- **The acceptance experiment must fix the Persona and Style.** ADR 0001 compares one condition against another; letting each session choose its own Style would add a second variable and the comparison would stop meaning anything. This is a constraint on the experiment, not on the product.
