<!--
The Misconception catalogue (ADR 0004): how learners typically get this Domain
wrong, stated as the learner would hold it, plus how it is refuted.

There is deliberately no `diagnosedBy` field here. Which checks detect a
misconception is stated by each check's `diagnoses`, and keeping a second copy
would let the two disagree. `npm run validate` derives reachability from the
checks and fails if an entry below cannot be diagnosed (ADR 0009).

Every entry here is a belief somebody actually holds. "Most people do not know
this" is not a misconception — it is ignorance, and it needs a lesson rather
than a refutation. The test each entry had to pass: could a competent
programmer state it confidently, in these words, and be wrong?
-->

# Misconceptions — UTF-8 编码与字符串长度

## M-utf8-is-a-charset

name: UTF-8 是一种字符集
wrongModel: 把 UTF-8 当成"一套字符"本身，于是认为"改成 UTF-8"就等于"支持全世界所有字符"，也认为支持 UTF-8 和支持中文是同一件事。
refutation: 字符集是 ISO/IEC 10646（Unicode）定义的那套字符；UTF-8 是这套字符的一种编码形式，负责把码点变成八位组。两者是不同层次的东西，同一套字符可以有多种编码形式。

## M-one-character-one-octet

name: 一个字符占一个字节
wrongModel: 认为字节数等于字符数，于是拿字节长度去估计"有几个字"，或者以为中文一个字固定占两个字节。
refutation: 占用几个八位组由码点所在的范围决定，1 到 4 个不等。RFC 3629 自己的例子：三个字符编成了九个八位组。字节长度只在纯 US-ASCII 文本里才等于字符数。

## M-glyph-equals-codepoint

name: 看到的一个字就是一个码点，显示一样就是一样
wrongModel: 认为读者看到的一个字与一个码点一一对应，于是认为显示相同的两个字符串一定逐字节相同，可以直接比较。
refutation: "é" 可以是预组合的 U+00E9，也可以是 U+0065 U+0301（字母加组合重音）——两个不同的字符序列，因而是两串不同的八位组。RFC 3629 把这种"同一事物、多个字符序列"的现象列为影响匹配、索引、查找、排序与选择的安全问题。

## M-string-length-is-character-count

name: 字符串长度就是字符个数
wrongModel: 认为各种语言里的 length 说的是同一件事，于是拿一个语言里的长度去对照另一个语言里的字数限制。
refutation: 长度取决于你在哪一层数：数八位组和数码点是两个不同的数。RFC 3629 的例子中，同一段文本既是三个字符，也是九个八位组。

## M-byte-sort-is-alphabetical

name: 按字节排序就是按字母排序
wrongModel: 认为把字符串按字节比大小就等于按字母排，于是认为用 UTF-8 就自动解决了多语言排序。
refutation: 按八位组值排序确实与按字符编号排序一致，但 RFC 3629 紧接着说明：基于字符编号的顺序"几乎从来不是文化上正确的顺序"，因此这条性质价值有限。

## M-any-byte-sequence-decodes

name: 解码器什么字节序列都能解
wrongModel: 认为只要用 UTF-8 解码器，任何字节序列都会解出某个字符，于是不把"非法编码"当成一个需要处理的情况。
refutation: 每种字符只有一种合法编码，长度区间彼此互斥。RFC 3629 要求解码器必须拒绝非法序列，并用过长编码 C0 80 举例：朴素解码器会把它解成 U+0000。
