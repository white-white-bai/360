<!--
Terminal Understanding Checks for this Domain (ADR 0003, ADR 0004).

Hand-authored and reviewed like every other asset, so the explainer has no path
to shaping the question that judges it. Each check must describe a situation the
explanation did NOT use — a check that re-asks what was just said measures
recall, not understanding.

`expected` is compared after the narrow normalisation documented in
src/checks/grade.ts. `diagnoses` entries are `<phrase> => <misconception-id>`,
and the first matching entry wins.

NO DIAGNOSIS PHRASE MAY APPEAR IN ITS OWN `expected`. A phrase that matches both
the right answer and the wrong one diagnoses nothing, and it does so silently —
the entry still looks reachable to the validator while firing on learners who
were correct.

Every misconception in misconceptions.md must be reachable from here:
`npm run validate` fails on an entry no check can diagnose (ADR 0009).

`T-` is the transfer asset: same claim, a situation the lesson never used. The
harness passes it explicitly, so the naming is documentation rather than
mechanism.
-->

# Checks — UTF-8 encoding and string length

## C-encoding-not-charset

prompt: 同事说："我们把系统改成 UTF-8 了，所以现在支持全世界所有字符。" 这句话把两件事混成了一件，是哪两件？
expected: 字符集和编码形式。字符集是 ISO/IEC 10646（Unicode）定义的那套字符，UTF-8 只是它的一种编码形式，负责把码点变成八位组
grounding:
  - P-utf8-is-an-encoding-form
diagnoses:
  - 就是一回事 => M-utf8-is-a-charset
  - 支持 UTF-8 就等于支持所有字符 => M-utf8-is-a-charset
  - 没有混 => M-utf8-is-a-charset

## C-nine-octets

prompt: 字符串「日本語」在 UTF-8 里占几个八位组？为什么不是每个字符一个？
expected: 九个八位组；占用几个八位组由码点所在的范围决定，这三个码点各占三个
grounding:
  - P-three-characters-nine-octets
  - P-octet-count-depends-on-the-code-point
diagnoses:
  - 三个八位组 => M-one-character-one-octet
  - 每个字符一个字节 => M-one-character-one-octet
  - 固定占两个 => M-one-character-one-octet

## C-precomposed-or-combining

prompt: 两个字符串在屏幕上显示出来一模一样，都是一个带重音的 "é"。它们一定逐字节相同吗？
expected: 不一定。é 可以是预组合的 U+00E9，也可以是 U+0065 U+0301（字母加组合重音）；两个不同的字符序列，各自只有一种八位组序列
grounding:
  - P-same-text-several-byte-sequences
diagnoses:
  - 显示一样就一定相同 => M-glyph-equals-codepoint
  - 一个码点就是一个字 => M-glyph-equals-codepoint
  - 肯定是同一个字符串 => M-glyph-equals-codepoint

## C-sort-order

prompt: 一份名单里有英文名、中文名和带重音的拉丁字母。如果直接按 UTF-8 的八位组值比较来排序，得到的是什么顺序？这个顺序能当字母顺序用吗？
expected: 与按字符编号排序一致；不能当字母顺序用，因为基于字符编号的次序几乎从来不是文化上正确的顺序
grounding:
  - P-byte-order-is-not-alphabetical
diagnoses:
  - 字节序就是字母序 => M-byte-sort-is-alphabetical
  - 可以当字母顺序 => M-byte-sort-is-alphabetical
  - 就是字母表顺序 => M-byte-sort-is-alphabetical

## C-overlong-invalid

prompt: 有人把字节序列 C0 80 交给解码器，说"这是 U+0000 的另一种写法"。这串字节在 UTF-8 里合法吗？解码器应该怎么做？
expected: 不合法。每段长度区间是互斥的，一个字符只有一种合法编码；过长编码必须被拒绝，而不是被解出字符
grounding:
  - P-only-one-encoding-is-valid
diagnoses:
  - 这是合法的 => M-any-byte-sequence-decodes
  - 两种写法都合法 => M-any-byte-sequence-decodes
  - 解码器应该接受 => M-any-byte-sequence-decodes

## C-length-is-not-one-number

prompt: 同一段文本的"长度"至少有两个数法。拿「日本語」来说，数八位组、数码点各是多少？为什么两个数不一样？
expected: 八位组是九，码点是三。两个数不同，因为一个码点会占不止一个八位组，占几个由它所在的范围决定
grounding:
  - P-three-characters-nine-octets
  - P-octet-count-depends-on-the-code-point
diagnoses:
  - 两个数一样 => M-string-length-is-character-count
  - 长度只有一个数 => M-string-length-is-character-count
  - 数哪个都是三 => M-string-length-is-character-count

## T-ascii-octet-count

prompt: 一段只包含英文字母、数字和空格的文本，按 UTF-8 编码之后，八位组数量等于字符数量吗？为什么？
expected: 相等；U+0000 到 U+007F 各占一个八位组，而且这些八位组值不会出现在多字节序列里
grounding:
  - P-ascii-is-valid-utf8
diagnoses:
  - 不相等 => M-one-character-one-octet
  - 比字符数多 => M-one-character-one-octet
