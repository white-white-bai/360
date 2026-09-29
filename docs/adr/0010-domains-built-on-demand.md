# A Domain can be built on demand from fetched sources, and nothing teaches until a person signs it

## The gap, and the one rule that makes it hard

The Catalogue's length is the honest statement of what the platform can teach (ADR 0002); it is also a cage, because it only grows when somebody curates a Domain by hand. The owner's decision is that a learner may type any topic and have the platform make the material. The hard part is not the pipeline. It is ADR 0004: **a model may not write the corpus.** A generated corpus is the one failure the machinery cannot detect from inside, because the validator would end up citing the generated text as its own ground truth.

## No passage is authored; every passage is selected — and the kernel proves it

The builder may not produce corpus text, so it does not. Its stages:

1. **Plan** — a topic in; a boundary, a working title, and candidate sources out. The model proposes public, citable documents (standards, specifications, official documentation) and says why each one.
2. **Fetch** — the sources are actually fetched, capped in size and time, and kept on disk with their URL, fetch date, and hash. A proposed source that does not exist is caught here, by the network rather than by trust.
3. **Select** — the model reads the fetched text and proposes passages: an id, a citation, and a quote.
4. **Prove** — the kernel checks that every quote actually OCCURS in the fetched document (normalized). A passage the model composed rather than selected is refused, not proofread.

That last step is the whole design. The model is an editor of real material and never a source, so ADR 0004's rule survives contact with automation: the corpus is still written by the documents it came from. Everything else in the builder is plumbing.

What the model MAY draft is the pedagogy — misconception candidates, glossary renderings, checks. Those are held to the same rules as any hand-written Domain (every check grounds in corpus passages; every misconception is reachable by a check) and they are drafts until signed.

Fetched text is **data, not instructions**: a page is an input. The builder says so in its prompts, caps what it reads, and keeps the sources on disk so the reviewer can look at exactly what the sessions will quote.

## The signature gate

Drafts live in `domains-draft/<id>/`, carrying `owner: TODO` and `corpusReviewedBy: TODO`. The validator already runs against any directory (`domainsDir`), so a draft is validated like a Domain and must be clean except for those pending markers. `review-domain` shows what would be taught — the sources, the passages, the checks — takes the reviewer's name, fills the reviewer and owner fields, re-validates, and moves the directory into `domains/`.

Until that signature, the draft is not in the Catalogue and no session can teach it. This is not friction for its own sake: the signature is where a machine comparison ("every quote exists") becomes a human claim ("these are the right sources, quoted fairly") — exactly the distinction ADR 0006 already draws between a machine report and a person accepting it. **The signer is the owner**: rights and accountability stay one thing, and a built Domain starts life with a name attached instead of accruing as an orphan.

## The learner-facing shape

"学什么" becomes a text input. A topic that resolves to an existing Domain teaches immediately; a topic with no Domain starts a build that reports its own progress (the phase surface ADR 0009 gave a session) and ends in "等审核" — it enters the Catalogue at the signature. A topic that already has an unsigned draft is answered with that draft's name, not with a second build: the shelf is visible from the page, and the signature is its only door. A first experience that was a refusal becomes a first experience that is a wait, and the wait produces something usable the next day.

## Consequences

- The builder ships as a CLI (`build-domain`, `review-domain`), and the board wraps the same pipeline: a typed topic that resolves teaches immediately, one that resolves to nothing runs the build with the same phase surface a session uses, and it ends at the signature. An ambiguous topic asks instead of guessing. **The signature has a page door too**: the board renders the draft — sources, passages, checks — and takes the reviewer's name, calling the same `signDraft` the CLI calls. One gate, two doors; the CLI remains for scripted and offline use. **A signature may also sweep the drafts it makes redundant** — near-duplicates by shared sources, listed with their shared count before anything is deleted. Deletion is never silent: it happens with the names in front of the person, and only when they leave the box ticked.
- Each built Domain keeps its fetched sources on disk: review is offline-checkable, and a re-review after a source changes is possible.
- The acceptance experiment is untouched — it runs on the fixed Domains — and a built Domain joins the Catalogue like any other.
- One build costs several model calls and fetches, paid once per Domain rather than per session.
- A built Domain can be wrong in ways a curated one has not been caught in yet: a poor source, a biased selection. It carries the same obligations as any Domain — an owner, a boundary, and the willingness to delete it.
