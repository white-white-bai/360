import test from "node:test";
import assert from "node:assert/strict";

import { parseFrontmatter, parseKeyValueBlock } from "../src/util/frontmatter.ts";
import { parseSections } from "../src/util/sections.ts";
import { parseCorpus } from "../src/grounding/corpus.ts";
import { parseChecks } from "../src/checks/load.ts";

test("frontmatter parses scalars and indented lists", () => {
  const { data, body } = parseFrontmatter(
    ["---", "id: time-zones", "name: 时间戳", "sources:", "  - RFC 3339", "  - RFC 9557", "---", "body here"].join("\n"),
  );
  assert.equal(data.id, "time-zones");
  assert.equal(data.name, "时间戳");
  assert.deepEqual(data.sources, ["RFC 3339", "RFC 9557"]);
  assert.equal(body, "body here");
});

test("frontmatter strips surrounding quotes but not inner ones", () => {
  const { data } = parseFrontmatter(['---', 'a: "quoted"', "b: 'single'", 'c: not "quoted"', "---"].join("\n"));
  assert.equal(data.a, "quoted");
  assert.equal(data.b, "single");
  assert.equal(data.c, 'not "quoted"');
});

test("frontmatter refuses a duplicate key instead of letting the last one win", () => {
  assert.throws(() => parseFrontmatter(["---", "a: 1", "a: 2", "---"].join("\n")), /declared twice/);
});

test("frontmatter refuses nesting rather than guessing at it", () => {
  assert.throws(
    () => parseFrontmatter(["---", "outer:", "  inner: value", "---"].join("\n")),
    /unsupported line/,
  );
});

test("an unterminated frontmatter block is refused", () => {
  assert.throws(() => parseFrontmatter("---\na: 1"), /unterminated/);
});

test("sections split on headings and keep fields apart from prose", () => {
  const sections = parseSections(
    ["# Title", "", "## P-one", "", "source: somewhere", "> the text", "", "## P-two", "", "source: elsewhere", "> more"].join("\n"),
    "test",
  );
  assert.deepEqual(sections.map((s) => s.id), ["P-one", "P-two"]);
  assert.equal(sections[0]?.fields.source, "somewhere");
  assert.match(sections[0]?.text ?? "", /the text/);
});

test("REGRESSION: a list item missing its `- ` marker is refused, not absorbed as prose", () => {
  // This is the bug that silently emptied a `diagnoses:` block while every
  // parser succeeded, disconnecting misconception diagnosis with no error at
  // all. The line below is what a tired hand writes, and it must fail loudly.
  assert.throws(
    () => parseSections(["## C-one", "", "diagnoses:", "  正常存在 => M-x"].join("\n"), "checks"),
    /is not a `- item`/,
  );
});

test("an indented list item with no preceding key is refused", () => {
  assert.throws(() => parseSections(["## S", "", "  - orphan"].join("\n"), "test"), /is not a `- item`/);
});

test("duplicate section ids are refused", () => {
  assert.throws(() => parseSections(["## same", "", "a: 1", "## same", "", "a: 2"].join("\n"), "test"), /duplicate section/);
});

test("corpus requires provenance on every passage", () => {
  assert.throws(
    () => parseCorpus(["## P-one", "", "> text without a source"].join("\n"), "d"),
    /required string key `source`/,
  );
});

test("corpus refuses a passage with a source but no text", () => {
  assert.throws(() => parseCorpus(["## P-one", "", "source: somewhere", "> "].join("\n"), "d"), /has no text/);
});

test("corpus strips blockquote markers from the passage text", () => {
  const corpus = parseCorpus(["## P-one", "", "source: RFC", "> first line", "> second line"].join("\n"), "d");
  assert.equal(corpus.passages[0]?.text, "first line\nsecond line");
});

test("checks parse diagnoses written as `<phrase> => <id>`", () => {
  const checks = parseChecks(
    [
      "## C-one",
      "",
      "prompt: 问题",
      "expected: 答案",
      "grounding:",
      "  - P-one",
      "diagnoses:",
      "  - 正常存在 => M-x",
    ].join("\n"),
    "d",
  );
  assert.deepEqual(checks[0]?.diagnoses, [{ marker: "正常存在", misconceptionId: "M-x" }]);
  assert.deepEqual(checks[0]?.grounding, ["P-one"]);
});

test("a diagnosis without the `=>` separator is refused", () => {
  assert.throws(
    () => parseChecks(["## C-one", "", "prompt: p", "expected: e", "diagnoses:", "  - 没有分隔符"].join("\n"), "d"),
    /must be `<phrase> => <misconception-id>`/,
  );
});

test("a check missing `expected` is refused rather than silently ungradable", () => {
  assert.throws(() => parseChecks(["## C-one", "", "prompt: p"].join("\n"), "d"), /required string key `expected`/);
});

test("list items after a scalar value name the offending key", () => {
  // The previous message here was a bare "unsupported line", which pointed at the
  // item line when the mistake was the scalar two lines above it.
  assert.throws(
    () => parseKeyValueBlock(["a: scalar", "  - item"], "test"),
    /`- item` found after key `a`, which already has a scalar value/,
  );
});

test("an indented line that is neither a key nor a list item is refused", () => {
  assert.throws(() => parseKeyValueBlock(["a:", "  not an item"], "test"), /unsupported line/);
});
