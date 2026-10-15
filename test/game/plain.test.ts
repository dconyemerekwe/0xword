import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasExactKeys, isIntegerInRange, plainFields, plainItems } from "../../src/game/plain.ts";

describe("plainFields", () => {
  it("copies the fields of a plain object", () => {
    assert.deepEqual(plainFields({ a: 1 }), new Map([["a", 1]]));
  });

  it("treats a JSON-parsed __proto__ as an ordinary key", () => {
    assert.deepEqual([...(plainFields(JSON.parse('{"__proto__":1}')) ?? []).keys()], ["__proto__"]);
  });

  it("rejects non-objects, arrays, class instances, symbol keys and getters", () => {
    for (const raw of [null, undefined, "a", 1, [], new Map(), { [Symbol("s")]: 1 }]) {
      assert.equal(plainFields(raw), null);
    }
    assert.equal(plainFields(Object.defineProperty({}, "a", { enumerable: true, get: () => 1 })), null);
  });
});

describe("plainItems", () => {
  it("copies the items of a plain array", () => {
    const raw = [1, null, "a"];
    const items = plainItems(raw, 3);
    assert.deepEqual(items, raw);
    assert.notEqual(items, raw);
  });

  it("accepts an empty array and one at the maximum length", () => {
    assert.deepEqual(plainItems([], 0), []);
    assert.deepEqual(plainItems([1, 2], 2), [1, 2]);
  });

  it("rejects an array over the maximum length", () => {
    assert.equal(plainItems([1, 2, 3], 2), null);
  });

  it("rejects holes, extra properties, getters, subclasses and non-arrays", () => {
    assert.equal(plainItems([1, , 3], 3), null); // index 1 is a hole
    assert.equal(plainItems(Object.assign([1], { extra: 2 }), 3), null);
    assert.equal(plainItems(Object.defineProperty([0], "0", { get: () => 1 }), 3), null);
    class Items extends Array<number> {}
    assert.equal(plainItems(Items.from([1]), 3), null);
    assert.equal(plainItems({ 0: 1, length: 1 }, 3), null);
    assert.equal(plainItems("ab", 3), null);
  });
});

describe("hasExactKeys and isIntegerInRange", () => {
  it("needs exactly the listed keys", () => {
    assert.equal(hasExactKeys(new Map([["a", 1]]), ["a"]), true);
    assert.equal(hasExactKeys(new Map([["a", 1]]), ["a", "b"]), false);
    assert.equal(hasExactKeys(new Map([["a", 1], ["b", 2]]), ["a"]), false);
  });

  it("accepts only integers within the range, ends included", () => {
    assert.equal(isIntegerInRange(1, 1, 6), true);
    assert.equal(isIntegerInRange(6, 1, 6), true);
    for (const value of [0, 7, 1.5, Number.NaN, "3", null]) {
      assert.equal(isIntegerInRange(value, 1, 6), false);
    }
  });
});
