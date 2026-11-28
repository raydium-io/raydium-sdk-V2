// Run against the built SDK: node --test test/fractionToSignificant.test.js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Fraction, Rounding } = require("../lib");

const up = (n, d, digits) => new Fraction(n, d).toSignificant(digits, undefined, Rounding.ROUND_UP);

test("toSignificant ROUND_UP sees a remainder below the guard digit", () => {
  assert.equal(up(124001, 100000, 3), "1.25");
  assert.equal(up(-124001, 100000, 3), "-1.25");
  assert.equal(up(1000001, 1000000, 2), "1.1");
  assert.equal(up(999001, 100000, 3), "10");
  assert.equal(up(1200001, 100000000, 2), "0.013");
});

test("toSignificant ROUND_UP leaves exact values alone", () => {
  assert.equal(up(124, 100, 3), "1.24");
  assert.equal(up(0, 7, 3), "0");
  assert.equal(up(1, 3, 3), "0.334");
  assert.equal(up(12449, 10000, 3), "1.25");
});

test("toSignificant other modes are unchanged", () => {
  assert.equal(new Fraction(124001, 100000).toSignificant(3, undefined, Rounding.ROUND_DOWN), "1.24");
  assert.equal(new Fraction(12449, 10000).toSignificant(3), "1.24");
  assert.equal(new Fraction(12450, 10000).toSignificant(3), "1.25");
  assert.equal(new Fraction(2, 3).toSignificant(4), "0.6667");
});
