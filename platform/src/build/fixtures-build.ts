import { FetchRefused } from "./fetch.ts";
import type { Fetcher } from "./fetch.ts";

/**
 * Fixtures for the domain builder, shared by the builder's tests and the board's.
 *
 * A made-up micro-topic on purpose: the machinery is what is under test, and a made-up spec
 * keeps the assertions about the pipeline rather than about someone's standards document.
 */

export const SOURCE_A = "https://spec.example/alpha";
export const SOURCE_B = "https://docs.example/beta";

export const DOC_A = [
  "Alpha specification — tokens.",
  "A token is the smallest unit the format defines, and the length of a token counts its characters and not its UTF-8 bytes.",
  'The spelling "UTF-8" names the encoding; the format itself is encoding-neutral.',
].join("\n");

export const DOC_B = [
  "Beta documentation — measuring.",
  "Trailing whitespace is not a token character, so it never contributes to the length of anything.",
  "A code point is one scalar value; two strings with the same code points are the same string, however they are written.",
].join("\n");

export const BUILD_PLAN = JSON.stringify({
  id: "token-length",
  name: "记号与长度",
  boundary: "只教记号的定义与长度如何计算，不涉及存储格式。",
  sources: [
    { url: SOURCE_A, why: "the specification for the format" },
    { url: SOURCE_B, why: "the official documentation" },
  ],
});

/**
 * The same plan, re-run: a different id and name, the SAME sources — a near-duplicate draft,
 * which is what a sweep is allowed to remove.
 */
export const BUILD_PLAN_TWIN = JSON.stringify({
  id: "token-length-twin",
  name: "记号与长度（重试）",
  boundary: "只教记号的定义与长度如何计算，不涉及存储格式。",
  sources: [
    { url: SOURCE_A, why: "the specification for the format" },
    { url: SOURCE_B, why: "the official documentation" },
  ],
});

export const BUILD_SELECTION = JSON.stringify({
  passages: [
    {
      id: "P-token-def",
      sourceIndex: 0,
      citation: "§1 — tokens",
      quote:
        "A token is the smallest unit the format defines, and the length of a token counts its characters and not its UTF-8 bytes.",
    },
    {
      id: "P-whitespace",
      sourceIndex: 1,
      citation: "measuring, second paragraph",
      quote: "Trailing whitespace is not a token character, so it never contributes to the length of anything.",
    },
  ],
});

export const BUILD_PEDAGOGY = JSON.stringify({
  glossary: {
    terms: [
      { term: "token", rendering: "记号" },
      { term: "code point", rendering: "码点" },
    ],
    neverTranslate: ["UTF-8"],
  },
  misconceptions: [
    {
      id: "M-bytes",
      name: "长度就是字节数",
      wrongModel: "我把长度理解成内存里占了多少字节。",
      refutation: "长度数的是字符；同一段文字用不同编码写出来，字节数会变，长度不会。",
    },
    {
      id: "M-trim-first",
      name: "先修剪空白再量",
      wrongModel: "我先去掉结尾空白，再数长度，应该一样。",
      refutation: "空白也是字符；修剪改变的是被量的对象，不是量法。",
    },
  ],
  checks: [
    {
      id: "C-length",
      prompt: "一个字符串的末尾多了三个空格，长度会变吗？为什么？",
      expected: "会变，因为空白也是字符，长度数的是字符而不是可见笔画。",
      grounding: ["P-token-def", "P-whitespace"],
      diagnoses: [{ phrase: "先去空白", misconceptionId: "M-trim-first" }],
    },
    {
      id: "C-codepoints",
      prompt: "同样一段文字，编码换了，长度会跟着换吗？",
      expected: "不会，长度数的是码点，编码只改字节写法。",
      grounding: ["P-token-def"],
      diagnoses: [{ phrase: "字节数", misconceptionId: "M-bytes" }],
    },
  ],
});

/** The three builder actors, scripted. */
export function builderScript(): Record<string, string | string[]> {
  return {
    "domain-planner": BUILD_PLAN,
    "passage-selector": BUILD_SELECTION,
    "pedagogy-author": BUILD_PEDAGOGY,
  };
}

/** A fetcher that serves the two documents above, and refuses everything else. */
export function documentedFetcher(documents: Record<string, string> = { [SOURCE_A]: DOC_A, [SOURCE_B]: DOC_B }): Fetcher {
  return async (url) => {
    const text = documents[url];
    if (text === undefined) throw new FetchRefused(`${url} is not one of the test's documents`);
    return {
      requested: url,
      url,
      fetchedAt: "2026-09-29T00:00:00.000Z",
      mediaType: "text/plain",
      sha256: "0".repeat(64),
      bytes: text.length,
      text,
    };
  };
}
