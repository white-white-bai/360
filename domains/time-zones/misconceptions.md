<!--
The Misconception catalogue (ADR 0004): how learners typically get this Domain
wrong, stated as the learner would hold it, plus how it is refuted.

There is deliberately no `diagnosedBy` field here. Which checks detect a
misconception is stated by each check's `diagnoses`, and keeping a second copy
would let the two disagree. `npm run validate` derives reachability from the
checks and fails if an entry below cannot be diagnosed (ADR 0009).

RETURNED — "UTC 和 GMT 是同一个东西" (M-utc-is-gmt). It was removed when no
passage supported it and no check could diagnose it. Checking RFC 9557 turned up
both: §1.2 says UTC is "often mistakenly referred to as GMT", and checks.md now
has C-utc-gmt. Grounding existed; it just had not been read yet.
-->

# Misconceptions — time stamps, time zones and daylight saving

## M-zone-is-an-offset

name: 时区就是一个偏移量
wrongModel: 认为"时区"和"偏移量"是同一件事，于是以为知道 -08:00 就知道对方用哪个时区。
refutation: 偏移量是某一瞬间的结果，时区是产生该结果的规则集合。同一个偏移量对应多个时区，而且同一个时区在不同瞬间的偏移量并不相同。

## M-dst-is-just-a-shift

name: 夏令时只是整体挪一小时，可以忽略
wrongModel: 认为夏令时等价于"把偏移量改一下"，因此不认为它会让某些本地时间消失或重复。
refutation: 夏令时切换会让一段本地墙上时间不存在（春季前跳，形成缺口）或出现两次（秋季回拨，形成重叠）。在重叠区间里，只有偏移量能区分先后两次。

## M-timestamp-carries-a-zone

name: 时间戳本身带着时区
wrongModel: 认为拿到一个时间戳就等于知道它对应哪个时区，于是直接把它渲染成本地时间。
refutation: 一个瞬时点（例如 Unix 秒）只确定时间轴上的一个点，不携带任何时区。要把它渲染成本地墙上时间，必须另外提供时区规则；RFC 3339 字符串携带的是偏移量，也不是时区标识。

## M-utc-is-gmt

name: UTC 和 GMT 是同一个东西
wrongModel: 把两个名字当成同一件事，于是认为在任何场合互换都不会出错。
refutation: GMT 是一个更早的时间标度，UTC 是它的后继。民用场合两者读数通常一致，所以这个错误不容易暴露；但它们不是同一个标度，涉及闰秒与法规文本时不能互换。

## M-z-equals-plus-zero

name: Z 和 +00:00 是同一件事
wrongModel: 认为字符串末尾写 Z 还是写 +00:00 完全等价，只是写法不同。
refutation: RFC 9557 更新了这一处：Z 表示"UTC 时刻已知，但本地偏移量未知"，等同于旧的 -00:00；而 +00:00 仍然表示"UTC 是首选的参考点"。两者语义不同。
