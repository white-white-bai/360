---
name: document-generate
description: "Generate missing documentation from scratch using the Diataxis framework (tutorial / how-to / reference / explanation). Use when asked to write docs, generate documentation, document a feature or module, create a tutorial, or explain how something works."
---

Produce complete, structured documentation for a feature, module, or whole project using the **Diataxis framework**. Its four quadrants each serve a different reader in a different mode:

- **Tutorial** — learning-oriented. Walks a newcomer from zero to a working example.
- **How-to** — task-oriented. Accomplishes one specific goal, assuming basic familiarity.
- **Reference** — information-oriented. Complete, accurate description of the surface.
- **Explanation** — understanding-oriented. Why it works the way it does.

**Research the whole, then write the parts.** Read the full code surface before writing a line; documenting from signatures alone produces docs that describe half the feature.

## Process

### 1. Scope and output format

Determine what to document: a named target (feature, module, file) if one was given, otherwise the whole project.

Then settle two things with the user before researching:

1. **Where the docs go** — inline in existing files, standalone files (e.g. `docs/`), or both. Recommend **both**: inline summaries for discoverability, deep docs for depth.
2. **Format conventions** — follow an existing `docs/` layout or doc framework (Docusaurus, MkDocs, Nextra, VitePress) if the project has one; otherwise plain Markdown under `docs/`.

### 2. Codebase archaeology

Output quality is proportional to the work here. Do not skip it.

- **Map the structure** — enumerate source files, excluding `.git`, `node_modules`, and build output.
- **Read the entry points** — README, ARCHITECTURE, CONTRIBUTING, `CLAUDE.md`/`AGENTS.md`, the manifest (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`), and the main entry file.
- **Read each target entity end to end** — the implementation, its tests (they reveal intended behavior and edge cases), the modules it depends on and that depend on it, and any `NOTE:` / `WHY:` / `DESIGN:` comments.

Then write out a concept map before drafting:

```
Target:          [feature/module]
Purpose:         [one sentence — what problem does it solve?]
Key concepts:    [3-5 concepts a reader must understand]
Public surface:  [commands, functions, config options, endpoints]
Dependencies:    [what it needs]
Dependents:      [what relies on it]
Edge cases:      [from tests and code]
Design decisions:[non-obvious "why" choices]
```

Report what you covered: "Researched N files, K public-surface items, M concepts, J design decisions."

### 3. Partition into quadrants

Not every entity needs all four. Decide per entity:

| Entity type | Tutorial | How-to | Reference | Explanation |
|---|---|---|---|---|
| User-facing feature | yes | yes | yes | maybe |
| CLI command or flag | maybe | yes | yes | no |
| Internal module / architecture | no | no | yes | yes |
| Config option | no | yes | yes | no |
| Design pattern / philosophy | no | no | no | yes |
| API endpoint | maybe | yes | yes | no |
| Multi-step workflow | yes | yes | no | maybe |

Print the plan (entity → quadrants to write). If it adds up to more than five new documents, confirm with the user before writing.

### 4. Write, in this order

Reference first — it establishes the vocabulary the other three lean on — then explanation, then how-to, then tutorial.

Templates and per-quadrant rules: [doc-templates.md](doc-templates.md).

### 5. Cross-link and make discoverable

- Link across quadrants: every reference doc to its how-to, every how-to to its reference, tutorials to both.
- Add the new documents to the README, and to any docs index or sidebar config.
- Every new document must be reachable within two clicks of the README.
- Grep the docs for `](` targets that don't exist.

### 6. Quality gates

Review every document against all three before committing.

**Accuracy**
- [ ] Every example runs if copy-pasted
- [ ] Every API description matches the real signature — types, defaults, constraints
- [ ] Every command shown produces the output described
- [ ] No references to renamed or removed entities

**Completeness**
- [ ] Reference covers 100% of the public surface
- [ ] How-tos cover the top three tasks a user would attempt
- [ ] Tutorials reach a working result within three steps
- [ ] Explanations name trade-offs, not just choices

**Voice**
- [ ] Written for a smart person who hasn't seen the code
- [ ] No jargon without a brief gloss on first use
- [ ] Active voice, concrete nouns, short sentences

### 7. Commit

Stage the new files by name — never `git add -A`.

Generated docs frequently contain example credentials. Before committing, scan the staged additions for anything shaped like a live secret (keys, tokens, PEM blocks, JWTs). A live-format credential in committed docs is a leak; obvious placeholders in examples (`AKIAIOSFODNN7EXAMPLE`) are fine. If you find a real one, unstage the file, remove it, and re-stage.

Commit with a `docs:` message naming the scope and the quadrants produced, then push.

If a PR exists, add a `## Documentation Generated` section to its body listing each file with its quadrant and a one-line description.

## Important rules

- **Research before writing.** Step 2 is not optional; skipping it produces surface-level docs.
- **Accuracy is non-negotiable.** Unsure about a detail? Read the source again. Do not guess.
- **Do not mix quadrants.** Tutorial content does not belong in reference, and reference does not belong in a how-to.
- **Time to first result.** A tutorial that hasn't shown something working by step 3 needs restructuring.
- **Completeness over minimalism.** Complete documentation is cheap now; write all of it, not a minimal slice.
