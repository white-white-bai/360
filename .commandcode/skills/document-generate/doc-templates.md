# Diataxis document templates

Four quadrants, four shapes. Pick the one that matches the reader's mode, and follow its shape exactly.

## Reference

```
# [Entity name]

[One paragraph: what it is, what it does, when you'd use it.]

## API / interface

[Complete public surface: functions, commands, config options, parameters. Types,
defaults and constraints pulled from code — not paraphrased loosely.]

## Options / configuration

[If applicable: every option with its type, default, and effect.]

## Examples

[Two or three real usages. Prefer output you actually ran, or code that would compile.]

## Related

[Links to the how-tos and explanations that give context.]
```

- Accuracy over elegance: every claim traceable to code.
- "Accepts a string" is not reference-grade; "accepts a string (max 256 chars, matching `^[a-z-]+$`)" is.
- No *why* — explanation's job.

## Explanation

```
# [Concept or design decision]

[Opening: the problem this design solves, in terms a smart reader who hasn't seen
the code understands.]

## The problem

[What goes wrong without this design. Concrete failure modes, not abstract risks.]

## The approach

[How the design solves it. ASCII or Mermaid diagrams for architecture.]

## Trade-offs

[What was given up. Every decision trades something — name it.]

## Alternatives considered

[If discoverable from comments, ADRs, or history: what was tried or rejected, and why.]
```

- Lead with the problem, not the solution.
- Prefer ASCII diagrams: grep-able, diff-friendly, render everywhere.
- "We chose X over Y because Z" is the gold standard.
- Do not repeat reference material — link to it.

## How-to

```
# How to [accomplish a specific task]

[One sentence: what you'll accomplish and the end result.]

## Prerequisites

[Versions, installed tools, config state.]

## Steps

1. [Action verb] [specific instruction]

   ```bash
   [exact command]
   ```

   [Expected output, if non-obvious.]

2. [...]

## Verification

[How to confirm it worked: a command, a URL, a test.]

## Troubleshooting

[Common failure modes and their fixes, pulled from tests and error handling.]
```

- The title starts with "How to". No exceptions.
- Every step is an action. Not "consider whether…" but "Run X" / "Add Y to Z".
- Always include verification.
- A troubleshooting section is mandatory if the task can fail.

## Tutorial

```
# [Title describing what you'll build]

[Opening: what you'll build, why it's useful, what the reader will understand by the
end. "You'll build a working X that does Y", not "this tutorial covers X".]

## What you'll need

[Tools, versions, prior knowledge. Link installation guides.]

## Step 1: [Set up the foundation]

[From a clean state. Show every command. Explain briefly on first encounter.]

```bash
[exact command]
```

[What just happened.]

## Step 2: [Build the first working piece]

[Reach a visible result fast.]

...

## Step N: [Final step]

## What you built

[Recap what the reader has, link the reference docs, suggest next steps.]
```

- **Time to first result: under three steps.** If nothing has visibly worked by step 3, restructure.
- Every step produces a visible change or output.
- Use the exact commands the reader types — no "run the appropriate command".
- If a step commonly fails, show the error and the fix inline.
- End with "What you built", tied back to the real use case.
