import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.mjs";

const { Rules, Engine } = load();
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test("성공 단계: 대성공 · 대실패 · 극단 · 어려움 · 보통 · 실패", () => {
  const code = (v, t) => Rules.level(v, t).code;
  assert.equal(code(1, 50), "crit");
  assert.equal(code(100, 90), "fumble");
  assert.equal(code(96, 40), "fumble");      // 기능 50 미만은 96~100 대실패
  assert.notEqual(code(96, 60), "fumble");
  assert.equal(code(10, 50), "extreme");
  assert.equal(code(25, 50), "hard");
  assert.equal(code(50, 50), "regular");
  assert.equal(code(51, 50), "fail");
});

test("d100: 00+0 = 100, 보너스는 작은 값 · 벌칙은 큰 값", () => {
  assert.equal(Rules.d100(seq(0, 0)).value, 100);
  assert.equal(Rules.d100(seq(5, 7, 2), 1).value, 25);   // 일의 자리 5, 십의 자리 7·2 중 작은 쪽
  assert.equal(Rules.d100(seq(5, 7, 2), -1).value, 75);
});

test("피해 보너스 표", () => {
  assert.equal(Rules.dbBuild({ 근력: 30, 크기: 30 }).db, "-2");
  assert.equal(Rules.dbBuild({ 근력: 50, 크기: 60 }).db, "0");
  assert.equal(Rules.dbBuild({ 근력: 80, 크기: 80 }).db, "1d4");
});

test("특성치 굴림 범위 (×5)", () => {
  for (let i = 0; i < 200; i++) {
    const r = Rules.rollChars(Engine.randInt);
    for (const [k, v] of Object.entries(r.chars)) {
      const [min, max] = ["크기", "지능", "교육"].includes(k) ? [40, 90] : [15, 90];
      assert.ok(v >= min && v <= max && v % 5 === 0, `${k}=${v}`);
    }
    assert.ok(r.luck >= 15 && r.luck <= 90);
  }
});

test("피해 식 해석", () => {
  assert.ok(Rules.parseDamage("1d6+1"));
  assert.ok(Rules.parseDamage("1d3", "1d4"));
  assert.equal(Rules.parseDamage("아무거나"), null);
});

test("/r 주사위 식", () => {
  const r = Engine.rollDice("2d6+3");
  assert.equal(r.expr, "2d6+3");
  assert.equal(r.rolls.length, 2);
  assert.ok(r.total >= 5 && r.total <= 15);
  assert.equal(Engine.rollDice("100d6"), null);
  assert.equal(Engine.rollDice("d1"), null);
  assert.equal(Engine.rollDice("hello"), null);
});
