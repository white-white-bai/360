<!--
NOT YET HUMAN-VERIFIED.

These are STATEMENTS the cited sources support, written in our own words. They
are NOT quotations, and they used to be formatted as blockquotes, which wrongly
implied they were verbatim. Do not treat any sentence here as the source's
wording.

Machine-checked 2026-09-28 against the fetched primary documents. Every passage
now cites a document that was actually opened and read:

  P-offset-is-signed                  RFC 3339 §4.2   HOLDS
  P-rfc3339-carries-offset-not-zone   RFC 3339 §5.6   HOLDS (edited, see 1)
  P-ixdtf-adds-zone-annotation        RFC 9557 §4.2   HOLDS
  P-zone-is-a-set-of-rules            RFC 9557 §1.2   HOLDS (re-sourced, see 2)
  P-gap-and-overlap                   RFC 9557 §1.2   HOLDS (re-sourced, see 2)
  P-utc-is-not-gmt                    RFC 9557 §1.2   HOLDS
  P-z-was-reinterpreted               RFC 9557 §2     HOLDS

Two corrections came out of checking, and both are worth remembering:

  1. P-rfc3339-carries-offset-not-zone used to claim "two different zones can
     share an offset". RFC 3339 does not say that. The claim is true, but the
     citation did not support it — precisely the drift this file exists to
     prevent. The clause was removed.
  2. P-zone-is-a-set-of-rules and P-gap-and-overlap used to cite the IANA tzdb,
     which nobody had opened. RFC 9557 §1.2 defines both precisely, so they now
     cite the document that was actually read. A verified source beats a
     better-sounding one.

A machine comparison is NOT a human review: it reads a document and reports,
where a person is accountable for the result (ADR 0006). Every passage here is
machine-checked and NONE has been signed off by a person, so the Domain must not
be used for the acceptance experiment (ADR 0001) and `npm run validate` keeps
reporting `corpus.review-outstanding` until a named person confirms the list above.
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

## P-z-was-reinterpreted

source: RFC 9557 §2 "Updating RFC 3339" — https://www.rfc-editor.org/rfc/rfc9557#section-2

RFC 9557 changes one reading of RFC 3339: an offset of "Z" no longer implies
that UTC is the preferred reference point for the time, and now means the same
as the old "-00:00" — the instant in UTC is known, but the local offset is not.
An offset of "+00:00" still implies the preferred reference point is UTC.

## P-ixdtf-adds-zone-annotation

source: RFC 9557 §4.2 "Examples" — https://www.rfc-editor.org/rfc/rfc9557#section-4.2

IXDTF extends RFC 3339 by allowing a time zone annotation alongside the offset,
for example "[America/New_York]", because an offset alone does not say which set
of rules applies.

## P-zone-is-a-set-of-rules

source: RFC 9557 §1.2 "Definitions" (Time Zone) — https://www.rfc-editor.org/rfc/rfc9557#section-1.2

A zone is a set of rules for the relationship between local time and UTC in a
place. Mathematically it maps instants to offsets, so it can be thought of as a
function. An IANA zone identifier such as "America/New_York" names such a rule
set, not a fixed offset, and those rules can change over time.

## P-gap-and-overlap

source: RFC 9557 §1.2 "Definitions" (Time Zone) — https://www.rfc-editor.org/rfc/rfc9557#section-1.2

Because a zone's rules shift the offset across a daylight saving transition,
some local wall-clock times correspond to no instant at all — a gap — and some
correspond to two — an overlap. Converting local time back to an instant is
therefore not always a single-valued operation.

## P-utc-is-not-gmt

source: RFC 9557 §1.2 "Definitions" (UTC) — https://www.rfc-editor.org/rfc/rfc9557#section-1.2

UTC is frequently called GMT by mistake. GMT is an earlier timescale, and UTC
was designed as its successor; the RFC states the confusion outright rather than
treating the two names as interchangeable.
