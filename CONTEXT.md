# Agent Teaching Platform

A platform that teaches a learner a chosen topic through a guided, visual classroom rather than a document. Its vocabulary exists to hold two lines clearly: *teaching* must stay distinct from *explaining*, and the set of teaching positions must stay deliberately small.

## Language

### Entry

**Catalogue**:
The set of Domains a learner may choose from at entry. Its length is an honest statement of what the platform can actually teach.
_Avoid_: Menu, marketplace, store, list

**Profession**:
The industry a learner names at entry — the door, not the lesson. A Profession holds a tier, a risk, a boundary (what will NOT be taught here), and a list of Domains. Its status is computed, never stored: open when a listed Domain is signed, planned when none is, closed when its risk is high. The skeleton is the official occupation classification; folk names ("三百六十行") are aliases, not taxonomy.
_Avoid_: Industry, job, career, trade

**Tier**:
How much of a Profession can be taught: A — text-verifiable knowledge, the full apparatus; B — standards-and-diagrams knowledge, taught with the note that it does not replace practice; C — embodied skill, where only the cognitive layer is taught and the boundary says so. Tier is independent of Risk.
_Avoid_: Level, grade, difficulty

**Risk**:
What happens if the platform teaches this wrong: ordinary, or high (people, property, or rights). A high-risk Profession is closed — it lists no Domains and both doors refuse its topics — until two independent reviewers can sign, which no Domain can yet do.
_Avoid_: Severity, danger, safety

**Category**:
A group of Professions from the official classification, shown at entry so the learner sees the shape of what exists. A category is not a Profession and teaches nothing.
_Avoid_: Section, division, bucket

### The teaching interaction

**Teaching**:
An interaction that closes with an understanding check. Explaining without a check is not teaching, however good it is.
_Avoid_: Explaining, presenting, content delivery

**Learner**:
The person being taught. The only actor whose understanding the platform is accountable for.
_Avoid_: User, student, end user, customer

**Understanding Check**:
The verification that closes a teaching interaction: a targeted check the learner must pass, biased toward applying the idea in a new situation rather than recalling it.
_Avoid_: Quiz, test, assessment, comprehension score, feedback

**Probe**:
A cheap, frequent, ungraded prompt during an explanation asking the learner to restate an assertion in their own words. It surfaces a misconception early and passes or fails nothing.
_Avoid_: Check, quiz, question, test

**Position**:
The part an expert plays within a single teaching session. v1 has two: Lead Explainer and Challenger.
_Avoid_: Role, seat, agent

**Lead Explainer**:
The position that carries an explanation. There is exactly one per session.
_Avoid_: Tutor, teacher, presenter, main agent

**Challenger**:
The position summoned at a specific point to surface a wrong intuition and refute it. It is not a second explainer and does not carry the lesson.
_Avoid_: Devil's advocate, critic, second expert, panel member, co-host

### Expert configuration

**Expert**:
A configured teaching unit, made of three independently swappable axes: Persona, Domain and Style.
_Avoid_: Role, 教学角色, agent, bot, character

**Persona**:
Who is speaking: the stance, register and formality an expert presents, and how it addresses the learner. Swapping it changes who is speaking, not what is said. A product-wide asset, reused across Domains.
_Avoid_: Personality, character, avatar, bot

**Domain**:
What an expert is authorized to assert, and therefore exactly where it must admit it does not know. Swapping it changes the knowledge boundary and nothing else. A usable Domain carries three assets: a Domain Corpus, a Misconception catalogue, and a Term Glossary.
_Avoid_: Knowledge base, expertise, topic, context

**Style**:
How an expert builds an explanation: analogy density, conclusion-first or motivation-first, level of abstraction, example type. Swapping it changes the delivery, never the content or the knowledge boundary. A product-wide asset, reused across Domains.
_Avoid_: Tone, format, voice, delivery, prompt

### Grounding

**Grounded Assertion**:
A claim about the world made while teaching. It must trace to a passage in the Domain corpus; the kernel enforces the trace, not the model.
_Avoid_: Fact, claim, statement, content

**Scaffold**:
An analogy, framing or example that makes an idea land. It may be ungrounded, but must be marked as scaffolding and never presented as a claim about the world.
_Avoid_: Analogy, metaphor, example, illustration

**Domain Corpus**:
The curated material a Domain's assertions must trace to, each passage carrying its provenance.
_Avoid_: Knowledge base, dataset, training data, content library, docs

**Misconception**:
A named way learners typically get a Domain wrong, together with how it is refuted. Gives the Challenger a target and gives an Understanding Check something to diagnose against.
_Avoid_: Error, mistake, wrong answer, confusion, edge case

**Term Glossary**:
The fixed renderings of a Domain's terminology into the delivery language, plus the identifiers that are never translated. Grounded Assertions must use these renderings.
_Avoid_: Dictionary, vocabulary, translation table, localisation file

**Assertion List**:
The ordered set of Grounded Assertions and Scaffolds that one explanation will deliver. It is verified against the Domain corpus before any narration is written.
_Avoid_: Lesson plan, outline, script, syllabus, agenda

### Ownership

**Library**:
The product-wide set of Personas and Styles, owned separately from any Domain.
_Avoid_: Registry, gallery, collection, asset store

**Owner**:
The named person accountable for a Domain's or a library's material staying correct and current.
_Avoid_: Author, maintainer, admin

### The blackboard

**Blackboard**:
The display surface of a teaching session. Its authoritative state is a sequence of blackboard events; the visible surface is a pure function of that sequence.
_Avoid_: Canvas, whiteboard, screen, slide, diagram

**Blackboard Event**:
An atomic, typed change to the blackboard. The only permitted way for anything to change it.
_Avoid_: Render command, draw call, update, mutation, patch

**Narration**:
The explanation that accompanies a session, carried as a stream separate from the blackboard events and sharing one timeline with them.
_Avoid_: Script, transcript, voiceover, content, speech
