<!--
NOT YET HUMAN-VERIFIED.

These are STATEMENTS the cited sources support, written in our own words — they
are NOT quotations, and they used to be formatted as blockquotes, which wrongly
implied they were verbatim. Do not treat any sentence here as the source's
wording.

What has been checked, and by whom, matters (ADR 0004 and ADR 0006):

  machine-checked 2026-09-28 against the fetched documents:
    P-offset-is-signed                    RFC 3339 §4.2   HOLDS
    P-rfc3339-carries-offset-not-zone     RFC 3339 §5.6   HOLDS AFTER EDIT
      an earlier version claimed "two different zones can share an offset",
      which RFC 3339 does not say. The claim is true but the citation did not
      support it, which is exactly the drift this file exists to prevent. The
      clause was removed.
  NOT yet checked against the source:
    P-ixdtf-adds-zone-annotation          RFC 9557
    P-zone-is-a-set-of-rules              IANA tzdb
    P-gap-and-overlap                     IANA tzdb theory.html

A machine comparison is NOT a human review: it reads one document and reports,
whereas a person is accountable for the result (ADR 0006). Until a named person
has checked the three remainders, this Domain must not be used for the
acceptance experiment (ADR 0001), and `npm run validate` reports
`corpus.review-outstanding`.
-->

# Corpus — time stamps, time zones and daylight saving

## P-offset-is-signed

source: RFC 3339 §4.2 "Local Offsets" — https://www.rfc-editor.org/rfc/rfc3339#section-4.2

An offset is computed as local time minus UTC, and a numeric offset carries an
explicit sign. A negative offset therefore means local time is behind UTC: the
RFC's own example notes that an offset of "-08:00" is 8 hours behind UTC.

## P-rfc3339-carries-offset-not-zone

source: RFC 3339 §5.6 "Internet Date/Time Format" — https://www.rfc-editor.org/rfc/rfc3339#section-5.6

The date-time grammar carries a time-offset, not a zone: the offset is either
"Z" or a signed numeric offset, and "Z" denotes a UTC offset of 00:00. Nothing
in the grammar names the zone whose rules produced that offset.

## P-ixdtf-adds-zone-annotation

source: RFC 9557 (Internet Extended Date/Time Format) — https://www.rfc-editor.org/rfc/rfc9557

IXDTF extends RFC 3339 by allowing a time zone annotation alongside the offset,
for example "[America/New_York]", because an offset alone does not say which set
of rules applies.

## P-zone-is-a-set-of-rules

source: IANA Time Zone Database — https://www.iana.org/time-zones

A zone identifier such as "America/New_York" denotes a set of rules, not a
fixed offset. The rules determine which offset is in effect at each instant,
including any daylight-saving transitions.

## P-gap-and-overlap

source: IANA tzdb, theory.html — https://data.iana.org/time-zones/theory.html

At a transition into daylight saving, some local wall-clock readings do not
occur at all — the clock jumps forward, leaving a gap. At a transition out of
daylight saving, some local wall-clock readings occur twice — the clock repeats,
creating an overlap. In the overlap, the offset is what distinguishes the first
occurrence from the second.
