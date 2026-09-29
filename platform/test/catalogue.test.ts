import test from "node:test";
import assert from "node:assert/strict";

import { NotOffered, catalogue, choose } from "../src/experts/catalogue.ts";
import { loadLibrary } from "../src/experts/load.ts";

const library = loadLibrary();
const offered = catalogue(library);

const first = <T>(items: readonly T[]): T => items[0] as T;

test("the catalogue offers a real choice of Persona and Style, not one option each", () => {
  // ADR 0007: "One Persona makes the choice vacuous". The validator warns below two;
  // this is the same requirement seen from the entry's side.
  assert.ok(offered.domains.length >= 1, "there must be something to learn");
  assert.ok(offered.personas.length >= 2, `personas offered: ${offered.personas.length}`);
  assert.ok(offered.styles.length >= 2, `styles offered: ${offered.styles.length}`);
});

test("every option says what it is, because a bare id is not a choice", () => {
  for (const group of [offered.domains, offered.personas, offered.styles]) {
    for (const option of group) {
      assert.notEqual(option.label.trim(), "", `${option.id} has no label`);
      assert.notEqual(option.detail.trim(), "", `${option.id} gives nothing to choose by`);
    }
  }
});

test("nothing in the catalogue names a default", () => {
  // ADR 0007's whole point. A `default: true` field would be the Domain deciding how it
  // is taught, and a Style the Domain owns has stopped being an axis.
  const json = JSON.stringify(offered);
  assert.doesNotMatch(json, /default/);
  assert.doesNotMatch(json, /recommend/);
});

test("choosing what was offered composes the three axes", () => {
  const domain = first(offered.domains);
  const persona = first(offered.personas);
  const style = first(offered.styles);

  const expert = choose(library, domain.id, persona.id, style.id);
  assert.equal(expert.domain.id, domain.id);
  assert.equal(expert.persona.id, persona.id);
  assert.equal(expert.style.id, style.id);
});

test("choosing something that was not offered is refused, not rounded to the nearest", () => {
  // The entry has no ground truth to guess from, which is why the learner chooses at
  // all. A resolver that accepted an unoffered id would put the guessing back.
  const domain = first(offered.domains).id;
  const persona = first(offered.personas).id;
  const style = first(offered.styles).id;

  assert.throws(() => choose(library, "no-such-domain", persona, style), NotOffered);
  assert.throws(() => choose(library, domain, "no-such-persona", style), NotOffered);
  assert.throws(() => choose(library, domain, persona, "no-such-style"), NotOffered);
});

test("the refusal lists what was on offer, so the mistake is fixable", () => {
  assert.throws(
    () => choose(library, "typo", "x", "y"),
    (error: Error) => error instanceof NotOffered && error.message.includes("time-zones"),
  );
});
