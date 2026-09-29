<!--
REVIEWED. Signed off by 白杨 on 2026-09-29 against the machine-check record below.

These are STATEMENTS the cited source supports, written in our own words. They
are NOT quotations. Do not treat any sentence here as the source's wording.

Machine-checked 2026-09-29 against the primary document, which was fetched and
read in full (RFC 3629, 14 pages, including the sections that are not cited
here). Every passage cites a section that was actually opened:

  P-utf8-is-an-encoding-form           RFC 3629 §1        HOLDS
  P-ascii-is-valid-utf8                RFC 3629 §1        HOLDS
  P-octet-count-depends-on-the-code-point  RFC 3629 §3    HOLDS
  P-first-octet-announces-the-length   RFC 3629 §1        HOLDS
  P-only-one-encoding-is-valid         RFC 3629 §3        HOLDS
  P-surrogates-cannot-be-encoded       RFC 3629 §3        HOLDS
  P-byte-order-is-not-alphabetical     RFC 3629 §1        HOLDS
  P-same-text-several-byte-sequences   RFC 3629 §10       HOLDS
  P-three-characters-nine-octets       RFC 3629 §7        HOLDS

ONE SOURCE, AND THAT IS A LIMIT. RFC 3629 is the Internet's normative
description of UTF-8 and is self-contained for everything above. It does not
cover grapheme clusters — what a reader perceives as one "character" when
combining marks are involved — so this Domain does not teach that layer. The
honest move was to leave the claim out rather than cite Unicode Standard Annex
#29, which has not been read. A Domain's boundary is set by what its sources
support, not by what would make a better lesson.

TWO KINDS OF EVIDENCE, and they are recorded separately on purpose. The check
above was made by a model comparing this text to the document; the sign-off in
`meta.md` is a person accepting that comparison. Neither substitutes for the
other, and conflating them is how "someone looked at it" becomes
indistinguishable from "a script ran". `npm run validate` requires both.
-->

# Corpus — UTF-8 encoding and string length

## P-utf8-is-an-encoding-form

source: RFC 3629 §1 "Introduction" — https://www.rfc-editor.org/rfc/rfc3629#section-1

ISO/IEC 10646 defines a large character set, the Universal Character Set, and
Unicode defines the same repertoire. Both also define several encoding forms of
that shared repertoire — UTF-8 among them, alongside UCS-2, UTF-16, UCS-4 and
UTF-32. UTF-8 is therefore one way of turning characters into octets, not the
set of characters itself.

## P-ascii-is-valid-utf8

source: RFC 3629 §1 "Introduction" — https://www.rfc-editor.org/rfc/rfc3629#section-1

Characters U+0000 to U+007F correspond to the octets 00 to 7F, so a plain
US-ASCII string is already a valid UTF-8 string. Octet values in the US-ASCII
range do not occur anywhere else in a UTF-8 stream, which is what lets software
that parses by looking for ASCII values — a C library's printf, a file system —
keep working on UTF-8 data.

## P-octet-count-depends-on-the-code-point

source: RFC 3629 §3 "UTF-8 definition" — https://www.rfc-editor.org/rfc/rfc3629#section-3

Characters in the range U+0000 to U+10FFFF are encoded as sequences of one to
four octets. Which length applies is decided by the character number — which the
same section also calls the code point or Unicode scalar value — so the number
of octets used varies from character to character rather than being fixed by the
encoding.

## P-first-octet-announces-the-length

source: RFC 3629 §1 "Introduction" — https://www.rfc-editor.org/rfc/rfc3629#section-1

The first octet of a multi-octet sequence indicates how many octets the sequence
has, and the octets that follow are all marked as continuations. One consequence
the document draws is that character boundaries can be found from anywhere in an
octet stream, without decoding from the start.

## P-only-one-encoding-is-valid

source: RFC 3629 §3 "UTF-8 definition" — https://www.rfc-editor.org/rfc/rfc3629#section-3

The length ranges are mutually exclusive: there is only one valid way to encode
a given character. Implementations must protect against decoding invalid
sequences rather than accepting them, and the section gives the overlong
two-octet sequence C0 80 as its example — a naive decoder reads it as U+0000.

## P-surrogates-cannot-be-encoded

source: RFC 3629 §3 "UTF-8 definition" — https://www.rfc-editor.org/rfc/rfc3629#section-3

UTF-8 prohibits encoding the character numbers U+D800 to U+DFFF. Those values
are surrogate code points, reserved for use with the UTF-16 encoding form, where
they occur in pairs, and they do not directly represent characters.

## P-byte-order-is-not-alphabetical

source: RFC 3629 §1 "Introduction" — https://www.rfc-editor.org/rfc/rfc3629#section-1

Sorting UTF-8 strings in lexicographic order by octet value gives the same order
as sorting them by character number. The document immediately qualifies that
this is of limited interest, because an order based on character numbers is
almost never culturally valid.

## P-same-text-several-byte-sequences

source: RFC 3629 §10 "Security Considerations" — https://www.rfc-editor.org/rfc/rfc3629#section-10

The same thing, as far as a reader can tell, can be written as more than one
character sequence. An "e" with an acute accent can be the precomposed U+00E9,
or the canonically equivalent sequence U+0065 U+0301 — the letter followed by a
combining acute. Each character sequence has exactly one octet sequence, so two
different octet sequences can denote the same visible text, and the document
warns that this affects string matching, indexing, searching, sorting, regular
expression matching and selection.

## P-three-characters-nine-octets

source: RFC 3629 §7 "Examples" — https://www.rfc-editor.org/rfc/rfc3629#section-7

In RFC 3629's own worked example, the three characters U+65E5 U+672C U+8A9E
encode as the nine octets E6 97 A5 E6 9C AC E8 AA 9E. Three characters, nine
octets.
