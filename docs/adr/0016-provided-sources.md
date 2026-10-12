# The second way in: authority a person already holds

## The gap

ADR 0010 gave the platform one way to make a Domain: the builder fetches public documents, a model *selects* passages from them, and the kernel proves every quote occurs in the text that was fetched. That check is the whole reason a built Domain is trustworthy — a composed quote is refused, not reviewed — and it is also why the builder has only ever produced software Domains.

Every source it can use must be fetchable. The planner's own instructions say so out loud: "public, citable, stable documents … prefer documents whose text is fetchable as HTML or plain text." RFCs, specifications and official documentation satisfy that. The knowledge of most of the 1639 professions does not. A 中式烹调师's authority is a national occupational standard, a GB standard, a textbook — PDFs and print, not pages. A 电工's is a wiring regulation, often a scanned or paywalled document. A 美发师's may be an industry teaching manual with no public text at all.

So the gap is not in the pipeline and not in the check. It is in **where the bytes come from**. As long as `build-domain` can only start from a URL, those walks of life cannot have a Domain, however good the machinery is. The choice is to accept that they never will, or to open a second entrance that keeps the same check behind it.

## The decisions

**1. The Owner may provide the sources, and the kernel is unchanged behind them.** `build-domain --from <dir>` reads every text file in `<dir>` as the build's documents, in sorted filename order, and runs the *same* seven stages. The model still only *selects* — `proveSelected` and `locateQuote` are not touched, not relaxed and not made optional. A quote that does not occur in the provided file stops the whole build exactly as an invented URL quote does. This is the point of the decision: a second entrance that skipped the proof would not be a second entrance to the same building.

**2. A source is a fetched document or a provided one, and the record says which.** A provided source is recorded under the scheme `local:<filename>`, in the corpus's `source:` lines, in `meta.md`'s `sources:` list and in `sources.json`. The scheme is what makes the distinction legible to code and to a reviewer without a second manifest format. `CONTEXT.md` gains **Provided Source** for it; a fetched document is a **Source** (a URL) and both are what a Domain's corpus may rest on.

**3. The check becomes the one this entrance can actually perform: existence and hash.** `corpus.source-unusable` was written to refuse a URL that names an error page — the failure mode of the URL entrance. The same code, at the same place, becomes the check of the file entrance: a `local:` source must resolve to a file that exists on disk, beside the Domain, under the filename the record names. A file that is missing is an error for the same reason a region-block page is: a passage that traced here was never backed by a document. `sources.json` already carries `sha256`, so the same pass reports a **warning** when the file's hash has drifted from what the build recorded — the corpus has changed since it was quoted from, which is a thing the owner must look at rather than a thing that invents a quote.

**4. The build itself does not drift.** The bytes the checker sees are the bytes the reviewer sees: `writeDraftFiles` copies the provided files into the draft's `sources/`, exactly as it copies fetched text, and the manifest points at them. `review-domain` prints a provided source as its filename rather than as a URL, because it is a file a person gave and not a page a person can open. Nothing is fetched, hashed or normalised differently between the two entrances — one `FetchedDocument` shape carries both.

**5. The plan may not invent sources under `--from`.** When the documents are provided, the plan names *what* is being taught and *where its boundary is*; it does not name sources, because the sources are already in hand and every one of them must be used. A plan that lists URLs in this mode is refused (`build.plan-from-conflict`), because a plan is a claim and a claim about sources the build did not fetch would be false in exactly the way ADR 0004 exists to prevent.

**6. What this does not decide.** It does not let the builder *write* corpus text, and it does not let the platform find authority it was not given — an Owner who puts the wrong document in the directory still gets a Domain that faithfully teaches the wrong thing. It does not widen the signature gate (ADR 0006/0010): a `--from` draft is an ordinary draft, and nothing teaches until a person signs it. And it does not claim to solve OCR, rights, or paywalled access; the Owner supplies text they have the right to use, and this ADR records the *entrance* rather than the procurement.

## Consequences

- Two entrances, one check. `BuildInput` gains an optional `local` field carrying the provided documents; when it is present the fetch stage consumes them instead of the network, and every later stage — select, prove, author, write, validate — is byte-for-byte the same code path.
- The `local:` scheme is the single predicate that separates the two kinds of source, so the validator, the reviewer's display and the overlap rule all read one fact rather than re-deriving it. A source with neither `http(s):` nor `local:` is refused by name rather than silently treated as one or the other.
- A provided Domain is still a Domain: same grammar, same rules, same catalogue. The only thing that changes at entry is where the material came from, which the record now states.
- This is the first of ADR 0012's structural gaps to be closed by *addition* rather than by a claim: the professions whose authority lives in documents a person holds are no longer structurally excluded from the platform. Whether their domains get built remains a person's decision (ADR 0006).

*Consolidates: provided-source-is-the-second-entrance; the-proof-does-not-move.*
