# A provided source is citable by its own name

## The gap

ADR 0016 gave a corpus a second entrance: a person puts authoritative text under `sources/`, and the builder selects and edits from it exactly as it does from a fetched page. The passages it writes cite the document the way every passage does — `<citation> — <url>` — and for a provided source the url is `local:<file name>`, which is the identifier `sources.json` keys on and the file the manifest hashes.

`npm run validate` then warns on every one of those passages. The passage-provenance rule's test is a URL (`https?://`) or one of the standard families whose ids are their own citation (`RFC|ISO|IEEE|ITU|IANA`) — a string that names a document a reader could go and open. `local:GB-50016.txt` names no URL and carries no standard-family word, so it fails, and the remedy the warning offers — *cite something a reader can open, e.g. `RFC 3339 §4.2 — https://…`* — points at exactly the entrance ADR 0016 was built to be the alternative to.

The check is not wrong about fetched sources. It is wrong about the vocabulary the platform itself introduced, and a warning that fires on **every** passage of a legitimate Domain is how a validator teaches its readers to stop reading warnings.

The integrity of a provided source is not this rule's business, and is not left unguarded: the same file already resolves every `local:` entry in `sources.json`, refuses one whose path is not a plain file name or whose file is missing (as an **error**, `corpus.source-unusable`), and warns when the file's sha256 no longer matches the one recorded at build time (`corpus.source-changed`). The passage rule only asks whether the string names anything at all. For a fetched source nobody checks that the URL resolves either — the manifest is where a source's identity is established, and for a provided one it checks strictly more.

## The decisions

**1. `local:` is a document identifier, on the same footing as a URL.** A provided source is a document a reader can have — the person who supplied it has it, and `sources.json` names it and hashes it. A passage that names one is citable, and the passage-provenance rule accepts it. This is parity, not a loosening: a passage citing `https://…` is likewise not checked against the manifest by this rule.

**2. The test becomes a named function with a third case.** `namesADocument(source)` in `src/validate/rules.ts` — a URL, a standard family, or a whitespace-delimited token that `isLocalSource` accepts. The predicate comes from the build layer (already imported by the same file) rather than a second spelling of `local:` in the validator, because a second copy of the vocabulary is a second place for the two entrances to disagree about what a provided source is called.

**3. `corpus.provenance-vague` keeps its teeth.** A source that names nothing recognisable — a bare title with no id, a placeholder-shaped string that `isPlaceholder` did not catch — still warns, and the remedy still points at a URL, because for a genuinely vague source a URL is the right advice. The rule loses one false positive, not its purpose.

**4. What this does not decide.** It does not weaken the manifest rule: a `local:` entry whose file is missing is still an error, and a changed hash is still a warning. It does not add a check that a `local:` citation corresponds to a manifest entry — that would be a new integrity rule for the passage check, and the two entrances would then be checked differently, which is the asymmetry this ADR removes rather than moves. And it does not change `isPlaceholder` or the placeholder remedy.

## Consequences

- `src/validate/rules.ts`: the inline `looksCitable` constant becomes `namesADocument(source)`, adding a `split(/\s+/).some(isLocalSource)` case. `isLocalSource` is already imported for the manifest rule; no new import.
- `test/validate.test.ts` gains cases: a passage citing `local:<file>` passes provenance; a passage citing a bare title still warns.
- A Domain built through `build-domain --from <dir>` (ADR 0016) validates with 0 errors **and without a provenance warning on every one of its passages** — which was previously unavoidable.

*Consolidates: local-is-a-document-identifier; the-name-comes-from-the-build-layer; provenance-vague-keeps-its-teeth.*
