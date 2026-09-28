<!--
Terminal Understanding Checks for this Domain (ADR 0003, ADR 0004).

Hand-authored and reviewed like every other asset, so the explainer has no path
to shaping the question that judges it. Each check must describe a situation the
explanation did NOT use — a check that re-asks what was just said measures
recall, not understanding.

`expected` is compared after the narrow normalisation documented in
src/checks/grade.ts. `diagnoses` entries are `<phrase> => <misconception-id>`,
and the first matching entry wins.
-->

# Checks — time stamps, time zones and daylight saving

## C-gap

prompt: 2026-03-08 凌晨，纽约的时钟从 01:59 直接跳到 03:00。那么本地时间 "2026-03-08 02:30" 在 America/New_York 是什么？
expected: 这个本地时间不存在，因为前跳形成了缺口
grounding:
  - P-gap-and-overlap
  - P-zone-is-a-set-of-rules
diagnoses:
  - 正常存在 => M-dst-is-just-a-shift
  - 只是偏移量不同 => M-dst-is-just-a-shift

## C-offset-vs-zone

prompt: 你拿到字符串 "2026-03-08T02:30:00-05:00"。仅凭这个字符串，你能确定它属于哪个时区吗？
expected: 不能，字符串只携带偏移量，不携带时区标识
grounding:
  - P-rfc3339-carries-offset-not-zone
  - P-ixdtf-adds-zone-annotation
diagnoses:
  - 可以，-05:00 就是那个时区 => M-zone-is-an-offset
  - 可以，它带着时区 => M-timestamp-carries-a-zone
