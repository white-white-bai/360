<!--
PHASE 1 SCAFFOLDING — NOT YET HUMAN-VERIFIED.

ADR 0004 requires every passage to carry provenance a third party can check, and
forbids model-generated ground truth. These passages are written by hand and cite
real documents, but no one has yet opened those documents and confirmed the
quotations line by line. Treat provenance here as PROPOSED, not established.

The Phase 3 validator will enforce that a source exists; it cannot enforce that
the source says this. Only a human reading the cited document can do that, and
until then this Domain must not be used for the acceptance experiment (ADR 0001).
-->

# Corpus — time stamps, time zones and daylight saving

## P-offset-is-signed

source: RFC 3339 §4.2 "Local Offsets" — https://www.rfc-editor.org/rfc/rfc3339#section-4.2

> The offset between local time and UTC is written as a signed difference, for
> example "-08:00". The sign carries information: a negative offset means local
> time is behind UTC at that instant.

## P-rfc3339-carries-offset-not-zone

source: RFC 3339 §5.6 "Date and Time" — https://www.rfc-editor.org/rfc/rfc3339#section-5.6

> An RFC 3339 date-time includes a time-offset, where "Z" is equivalent to
> "+00:00". What the text carries is an offset. It does not name the zone whose
> rules produced that offset, and two different zones can share an offset at a
> given instant.

## P-ixdtf-adds-zone-annotation

source: RFC 9557 (Internet Extended Date/Time Format) — https://www.rfc-editor.org/rfc/rfc9557

> IXDTF extends RFC 3339 by allowing a time zone annotation alongside the
> offset, for example "[America/New_York]", because an offset by itself is not
> enough to know which set of rules applies.

## P-zone-is-a-set-of-rules

source: IANA Time Zone Database — https://www.iana.org/time-zones

> A zone identifier such as "America/New_York" denotes a set of rules, not a
> fixed offset. The rules determine which offset is in effect at each instant,
> including any daylight-saving transitions.

## P-gap-and-overlap

source: IANA tzdb, theory.html — https://data.iana.org/time-zones/theory.html

> At a transition into daylight saving, some local wall-clock readings do not
> occur at all — the clock jumps forward, leaving a gap. At a transition out of
> daylight saving, some local wall-clock readings occur twice — the clock
> repeats, creating an overlap. In the overlap, the offset is what distinguishes
> the first occurrence from the second.
