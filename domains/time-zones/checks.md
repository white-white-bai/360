<!--
Terminal Understanding Checks for this Domain (ADR 0003, ADR 0004).

Hand-authored and reviewed like every other asset, so the explainer has no path
to shaping the question that judges it. Each check must describe a situation the
explanation did NOT use — a check that re-asks what was just said measures
recall, not understanding.

`expected` is compared after the narrow normalisation documented in
src/checks/grade.ts. `diagnoses` entries are `<phrase> => <misconception-id>`,
and the first matching entry wins.

Every misconception in misconceptions.md must be reachable from here:
`npm run validate` fails on an entry no check can diagnose (ADR 0009).
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

## C-overlap

prompt: 2026-11-01 凌晨，纽约的时钟从 01:59 回拨到 01:00。那么本地时间 "2026-11-01 01:30" 在 America/New_York 是什么？
expected: 这个本地时间出现两次，只给本地时间无法确定是哪一次
grounding:
  - P-gap-and-overlap
diagnoses:
  - 正常存在一次 => M-dst-is-just-a-shift
  - 只是偏移量不同 => M-dst-is-just-a-shift

## T-fixed-offset

prompt: 有人写了一个函数，把全年所有"纽约本地时间"都按固定偏移量 -05:00 转成时刻。这个函数会在什么时候出错，为什么？
expected: 全年都按 -05:00 解释，忽略了偏移量随季节变化；切换日会出现不存在的本地时间（被当成有效时间）和重复出现的本地时间（只能取到其中一次），两个方向都错
grounding:
  - P-zone-is-a-set-of-rules
  - P-gap-and-overlap
diagnoses:
  - 固定偏移量就代表那个时区 => M-zone-is-an-offset
  - 只要夏令时当天特殊处理 => M-dst-is-just-a-shift
  - 不会有问题 => M-zone-is-an-offset

## C-offset-vs-zone

prompt: 你拿到字符串 "2026-03-08T02:30:00-05:00"。仅凭这个字符串，你能确定它属于哪个时区吗？
expected: 不能，字符串只携带偏移量，不携带时区标识
grounding:
  - P-rfc3339-carries-offset-not-zone
  - P-ixdtf-adds-zone-annotation
diagnoses:
  - 可以，-05:00 就是那个时区 => M-zone-is-an-offset
  - 可以，它带着时区 => M-timestamp-carries-a-zone

## C-utc-gmt

prompt: 有人在代码注释里把 UTC 和 GMT 换着写，并说"反正这两个是一回事"。这个说法在民用场景下为什么很少出事，又在什么情况下会真的出问题？
expected: 民用场合两者读数通常一致，所以很少暴露；但它们不是同一个标度，GMT 更早、UTC 是它的后继，涉及闰秒与法规文本时不能互换
grounding:
  - P-utc-is-not-gmt
diagnoses:
  - 本来就是一回事 => M-utc-is-gmt
  - 两者是同一个东西 => M-utc-is-gmt
  - 只是叫法不同 => M-utc-is-gmt

## C-z-vs-plus-zero

prompt: 下面两个字符串表示的时刻相同，含义也相同吗？"2026-03-08T02:30:00Z" 与 "2026-03-08T02:30:00+00:00"
expected: 时刻相同，含义不同：Z 表示本地偏移量未知，+00:00 表示 UTC 是首选参考点
grounding:
  - P-z-was-reinterpreted
diagnoses:
  - 完全相同 => M-z-equals-plus-zero
  - 只是写法不同 => M-z-equals-plus-zero
  - 等价 => M-z-equals-plus-zero
