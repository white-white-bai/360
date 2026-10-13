# An unreadable record is named, not fatal

## The gap

ADR 0019 put a real learner's trial on disk, one JSON file per sitting under `platform/.experiments/`, and `ExperimentStore.list()` reads the shelf by calling `load()` on every `.json` it finds. `load()` throws on anything that is not a well-formed recorded trial — correct for `load`, because a caller asking for one record and receiving a malformed one has to hear about it — but `list()` is a **directory** read, and it inherited that strictness by accident. One bad file makes the whole shelf unreadable.

Where this bites is the report. `run-experiment.ts` calls `list()` after every trial has already run: six live model calls, real money, minutes of wall clock. The exception lands after the run and before the panels, so the entire comparison is computed and thrown away, and what the operator sees is a stack trace — which reads as "the experiment is broken" rather than "one file on the shelf is broken". The measurement most expensive to produce is the one destroyed by the cheapest defect.

Two things put a bad file there. A hand-edited or half-copied record is the obvious one. The other is the store itself: `save()` is a bare `writeFileSync`, so a process killed mid-write leaves a **truncated** file behind — the store manufactures exactly the defect that destroys the report. And because `revise()` (the follow-up path, ADR 0019's second process) writes through `save()`, the window is open on every completed retention measurement, not only on first record.

## The decisions

**1. Reading the shelf and reading one record are different acts.** `ExperimentStore` gains `scan(): { records, unreadable }`. Every `.json` in the directory is attempted; one that throws contributes an entry to `unreadable` — its file name and the error's message — and is skipped. The rest of the shelf is returned. `load()` is unchanged and still throws, because a caller that named one record still must not be handed silence.

**2. A record the report cannot read is named, not dropped.** The skip is **displayed**. `run-experiment.ts` prints an `UNREADABLE RECORDS` line for each file with the reason, next to the panel the file is missing from, whether or not any other record was read. A silent skip would be worse than the crash it replaces: the whole point of the report is that a sitting that happened gets counted, and a record that is quietly absent reads as a sitting that never happened. The one outcome the platform must never produce is a person's hour disappearing into a table without a mark.

**3. `list()` keeps its meaning and its callers.** It becomes `scan().records.sort(...)` — same signature, same order, same empty state for a missing directory. The existing callers and the tests that pin that behaviour (the round trip, the ordering, "a missing store is empty and stays that way") are unaffected, because the readable case is the same call it always was.

**4. A write is atomic, because a partial record is worse than an absent one.** `save()` writes to `<path>.tmp` and renames it into place. A rename within one directory is atomic, so a killed process leaves either the old record or the new one, never half of either. The temporary name deliberately does **not** end in `.json`, so a crashed write is invisible to the scan rather than arriving as an unreadable record — it is debris, and debris is not a sitting. A record that exists is a record that is whole.

**5. A JSON parse failure says which file it was.** `load()` wraps `JSON.parse` so the thrown message carries the path — otherwise the most common corruption reports itself as Node's bare `Unexpected end of JSON input`, and the one thing `unreadable` exists to tell a reader is *which file*.

**6. What this does not decide.** It does not attempt repair, quarantine or deletion of a bad file: the store reads, and a person decides. It does not relax `load()` or `assertRecordedTrial` — a corrupt record is still refused at the door, and the boundary ADR 0019 put there (a simulation cannot be filed as a person's trial) is untouched. It does not extend to `FileSessionStore.save`, which writes the same non-atomic way and has the same hazard: that is a second store's write path and a second decision, not a consequence of this one.

## Consequences

- `src/experiment/records.ts` gains `UnreadableRecord` (`{ file, reason }`) and `StoreScan` (`{ records, unreadable }`); `scan()` is the reader, `list()` delegates to it, `save()` writes through a `.tmp` and `renameSync`, and `load()`'s parse failure names its path.
- `run-experiment.ts` reads the store through `scan()` and prints an `UNREADABLE RECORDS` block when any file could not be read — before the panels, so a reader meets the caveat and the numbers together.
- `test/records.test.ts` gains cases: a corrupt file beside a good one is skipped and named while the good one is still listed; a truncated write is not what a later read gets.

*Consolidates: reading-the-shelf-is-not-reading-one-record; an-unreadable-record-is-named-not-dropped; a-record-that-exists-is-whole.*
