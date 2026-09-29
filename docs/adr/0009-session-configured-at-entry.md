# A session is configured at entry: what is taught, how, by whom, and on which model

## A Position is a part; an Expert is a voice

The build composed *one* Expert and had both Positions played by it. That was not a decision — it was an artifact of how a session was assembled — and making the Challenger selectable separates the two properly: each Position is voiced by its own Expert, and the two **share the Domain and the Style**. The refutation has to come from the same corpus and the same misconception catalogue the lesson was taught from, and one choice of how the session is taught covers the whole session; only the voice is chosen twice.

Why let the personas differ at all: "who teaches" and "who challenges" are preferences the platform has no ground truth to guess, which is the argument that made Persona a learner choice at entry (ADR 0007). A recognizably different voice is also part of what makes the Challenger a challenger rather than a second explainer (ADR 0003) — the role is already distinct on the board; now it can sound distinct.

## The configuration travels with the connection

The board gains an entry step: `GET /options` describes what is on offer, the page renders it, and the session starts when the page connects `GET /board` with the choices as parameters. There is no server-side state between browsing the options and starting the lesson — the URL *is* the request. An unoffered id is refused rather than defaulted, in the same voice ADR 0007 used for the terminal's entry: a resolver that guesses has simply moved the guessing somewhere less visible.

What is chosen here: the Domain, the Style, the Persona of the Lead Explainer, the Persona of the Challenger, and the model. That is the whole of ADR 0007's entry, plus the two things ADR 0007 could not have: who challenges, and what runs underneath. The terminal has offered the first three since it was built; the two entry surfaces now agree.

The Domain is rendered as the Catalogue itself — every entry visible, with its one-line detail — rather than a dropdown. Its length is the honest statement of what can be taught (ADR 0002), and a collapsed list hides exactly the thing that statement is about. The other four are knobs, and knobs fit in dropdowns.

## The model list is configuration, not discovery

`ATP_MODELS`, when set, is the list of models this deployment is willing to run; with no list, the single configured model is the whole choice. Deliberately not the endpoint's `/models`: that would make what the page offers a function of whatever a gateway happens to expose, and the operator would lose the ability to say "not this one" without changing the gateway. The list's length is the same kind of honest statement as the Catalogue's length (ADR 0002) — except that here the honesty is about money.

## A recording is locked to what it recorded

All of the above is for live sessions. The recorded demo is one take — one Domain, one Style, one voice teaching one lesson — and giving it selectors would be the same lie as offering it a question it has no answer on file for (ADR 0008). `/options` reports it as a fixture, the page locks the choices to what the take contains, and the board refuses anything else. A recording is honest about being one take.

## Consequences

- `runApparatusSession` takes the Challenger's Expert, defaulting to the lead's — which is what every session before this decision had.
- `selectLiveProvider` takes the chosen model, so "which model taught this" still has exactly one construction path; the choice does not become a second way to build a provider that the rest of the platform cannot see.
- The board page gains a setup step, and a multi-line dialog at the bottom for the learner's own questions. Answers still land on the board rather than in a chat transcript (ADR 0008) — the dialog is for asking, and the board is where teaching lives.
- The chosen model is the session's model for every actor in it, and it is metered like every other call.
