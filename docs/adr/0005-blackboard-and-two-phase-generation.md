# The blackboard is event-sourced, and explanation is two-phase

## Event sourcing

A blackboard's authoritative state is an ordered sequence of **Blackboard Events**. The visible surface is a pure function of that sequence. A model is never permitted to manipulate the surface, a canvas state, or pixels directly.

Events come from a **closed vocabulary** — put text, draw a shape, point, highlight, erase — plus one **restricted rich-content channel** for what a closed vocabulary cannot carry (geometry, circuit diagrams, sequence charts). That channel is constrained, validated, and must be declared as such. It is not a general licence to emit markup.

Why the event-sourcing property matters more than the event vocabulary:

- **It makes the retry rule implementable.** "Explain it differently" requires the blackboard to be *regenerable*. If the board were mutable state that a model edits while it talks, a retry would collapse into "now describe what you just erased" — not reproducible. Event-sourced, a retry is simply a new event sequence and nothing special is needed.
- **It is what makes headless acceptance possible.** v1 is accepted by replaying the event stream. That only means something if the stream *is* the state; otherwise you are replaying a heap of partial render instructions.
- **It moves layout from the model to the renderer.** The model says "a two-column comparison, contents as follows"; where it lands, how wide the columns are, and what happens when it does not fit is code, not generation. A model that touches layout produces a surface that is fine one session and broken the next.

**Narration and blackboard events are two streams on one timeline.** Real-time display needs them aligned — says here, draws here — and the per-assertion grounding check needs narration to be separable. Neither is possible if a single output interleaves talking with drawing.

## Two-phase generation

A single explanation is produced in two phases. First the expert emits an **Assertion List** — the ordered Grounded Assertions and Scaffolds it intends to deliver. That list is verified against the corpus *before* any narration is written. Then narration streams, with blackboard events following it.

The product promises a real-time blackboard and interruptible teaching, and the verification stack cannot be run after a full explanation without destroying that promise. Verifying a list is cheap — it is an order of magnitude shorter than the narration it produces — so the expensive check happens once, on a small artifact, while the learner-facing output stays streaming. **Real-time starts when the list passes, not when the learner asks.**

**Streaming is a delivery mechanism, not a second source of truth.** Steps are shown as they arrive, but the turn is only accepted if the board the learner watched is the board the finished turn describes — a stream that diverges from the parse is refused, because the alternative is a session record that contradicts what was taught. Two consequences follow. A live board redraws from the *events*, not from the deltas, so there is still exactly one renderer. And a provider that cannot stream is still a valid provider: it arrives in one piece, and nothing else about the session changes.

Three things this buys beyond latency:

- blackboard events follow the list, so the board is scripted rather than improvised mid-sentence, and pacing becomes controllable;
- diagnosis gets an anchor — a check is written against a named assertion rather than against "the explanation";
- a retry becomes cheap — "explain it differently" re-realises the same list, changing the narration rather than what is being taught.

Verification is narrowed to the assertion classes where being wrong is both harmful and detectable — numbers, definitions, named causal claims. Scaffolds are not checked for truth, only for being marked as scaffolds.

**Fallback:** an assertion arising mid-narration rather than from the list is verified asynchronously and corrected explicitly. Explicit correction has real teaching value — "I said X, that was wrong, and here is why" — but it must stay the exception. If correction becomes routine, the premise of the product — that this teaching can be trusted — is gone.

*Consolidates: blackboard-is-event-sourced; two-phase-verified-assertion-list.*
