# Correctness without self-verification: grounded claims, curated corpus, independent checks, catalogued misconceptions

One rule runs through all of it:

> **No actor verifies its own output.**

## Grounding is enforced by the kernel, not by instructions

An expert will not stay inside its Domain because its instructions say to. Every **Grounded Assertion** must trace to a passage in the Domain's curated, provenance-tracked corpus, and anything outside that boundary must be emitted as an explicit "I do not know" rather than asserted.

Explanations split in two, and the two are held to different standards:

- **Grounded Assertion** — a claim about the world. Must trace to a corpus passage. The kernel checks traceability; the model does not self-police.
- **Scaffold** — an analogy, framing or example. May be ungrounded, but must be *labelled* as scaffolding and never presented as a claim.

Why not state the boundary in the prompt? A prompt cannot enforce a boundary, and a fluent wrong explanation is exactly the failure a learner cannot detect. Why not fact-check everything? Pedagogically the most useful material is not literal fact; a fact-checker applied to all of it either deletes the teaching or buries it under hedges until nobody understands anything.

**"I do not know" is a first-class output and a tested behaviour** — out-of-Domain probe questions must produce a refusal. A safety mechanism that cannot be tested does not exist.

## The corpus is curated, and owned

A Domain's material is assembled from public authoritative sources — standards documents, textbooks, official API documentation — with every passage keeping its provenance. Each Domain has a **named Owner** accountable for it staying correct as those sources change.

**Generating the corpus with a model is explicitly out.** The failure is circular and, worse, invisible: the errors the check exists to catch get written into the ground truth, and the validator then cites them as evidence. Model-written material reads as the tidiest and most authoritative precisely *because* it was generated. That is not a shortcut — it is pouring the foundation on sand.

Configuration rights and accountability are the same thing and cannot be split: **an unowned Domain rots silently.**

## A Domain is three assets

**Domain Corpus** (what is true), **Misconception catalogue** (how people typically get it wrong), **Term Glossary** (fixed renderings into the delivery language). The corpus feeds the explanation; the catalogue gives the Challenger a target and gives the check something to diagnose against.

## Checks are authored and graded independently

The check is not written or graded by the Lead Explainer. A separate step authors it, anchored to the corpus, preferring an objectively decidable form — execute the code, produce a deterministic output — before falling back to model grading, which must cite the passage it relies on.

An explainer that writes its own check will not write the question that exposes its own gap. It routes around what it explained poorly, then grades itself and passes — a near-100% pass rate that *reads as success* while actually being evidence that the mechanism measures nothing. That is the most dangerous kind of metric: it makes a broken product look like a working one.

Structurally the author cannot be the explainer, because a transfer check must use a situation the explanation did not use, and finding that situation requires knowing what **was** explained in order to avoid it. The check author is not a Position — Positions are parts an expert plays inside a session; authoring happens outside it.

## The check must yield a diagnosis

A failed check has to say *how* the learner got it wrong, not merely that they did. Each anticipated wrong answer or failure mode maps to a specific **Misconception**, which the Challenger then attacks by name. Where the failure was not anticipated, or the answer is free-form, ask the learner why they answered that way *before* challenging.

A Challenger that guesses at the learner's mental model will refute a position the learner does not hold — a **strawman**. That is worse than not challenging: it makes the learner doubt an understanding that was correct, and it spends the trust the whole session depends on. Manufacturing confusion and failing to correct it are the same class of harm, and the first is harder to undo.

Getting the learner to articulate their own intuition is the classic move that turns a hidden misconception into an explicit one, and it is the cheapest reliable signal the system has.

## Grounding traces to the source language

Grounding is evaluated against the **source-language** passage, never a translation. The delivery language is free; the translation layer between the two is not trusted, it is constrained. The **Term Glossary** pins the renderings, and identifiers (`UTC`, `America/New_York`, `RFC 9557`) are citations — translating a citation yields a different thing that merely resembles the original.

Why not translate as we go, unchecked? It inserts an unchecked step at the very end of a chain whose entire purpose is verification — the closest step to the learner, and the only one that can fool the verifier *and* the learner simultaneously. Building the machinery and then routing around it in the last step is worse than not having it: it buys false confidence. Why not translate the corpus and trace there? That silently changes what is being verified; a translation-versus-assertion check can never catch an error in the translation itself.

*Consolidates: grounding-by-corpus-not-prompt; curated-corpus-with-owners; independent-check-authoring-and-grading; diagnosis-and-misconception-catalogue; ground-to-source-language-with-term-glossary.*
