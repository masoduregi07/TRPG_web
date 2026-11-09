import test from "node:test";
import assert from "node:assert/strict";
import { load, sample } from "./load.mjs";

const m = load();
const { Engine } = m;

test("샘플 시나리오: 오류 없음", () => {
  const { errors } = Engine.validateScenario(sample(m));
  assert.equal(errors.length, 0, errors.join("\n"));
});

test("시나리오 검사: 없는 NPC · 잘못된 이미지 · 단서 id 중복", () => {
  const sc = sample(m);
  const first = sc.events ? Object.values(sc.events)[0] : Object.values(sc.scenes)[0];
  first.npcs = [...(first.npcs ?? []), "없는사람"];
  first.image = "javascript:alert(1)";
  const { errors } = Engine.validateScenario(sc);
  assert.ok(errors.some((e) => e.includes("없는사람")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("image")), errors.join("\n"));
});

test("이미지 주소 형식", () => {
  assert.ok(Engine.isImageURL("https://a.b/c.png"));
  assert.ok(Engine.isImageURL("data:image/png;base64,AAAA"));
  assert.ok(!Engine.isImageURL("javascript:alert(1)"));
  assert.ok(!Engine.isImageURL("data:text/html;base64,AAAA"));
});

test("단서 공개는 한 번만 · 이동은 열린 출구만", () => {
  const sc = sample(m); Engine.validateScenario(sc);
  const st = Engine.newState(sc);
  const s = Engine.sceneOf(sc, st);
  const clue = (s.clues ?? [])[0];
  if (clue) {
    assert.ok(Engine.revealClue(sc, st, clue.id));
    assert.equal(Engine.revealClue(sc, st, clue.id), null);
  }
  assert.equal(Engine.move(sc, st, "존재하지않는사건"), false);
});

test("플레이어용 화면 정보에 GM 전용 내용 없음", () => {
  const sc = sample(m); Engine.validateScenario(sc);
  const st = Engine.newState(sc);
  const pub = JSON.stringify(Engine.publicView(sc, st));
  const s = Engine.sceneOf(sc, st);
  if (s.gm_only) assert.ok(!pub.includes(String(s.gm_only).slice(0, 20)));
  for (const id of s.npcs ?? []) { const sec = sc.npcs[id].secret; if (sec) assert.ok(!pub.includes(sec), `NPC 비밀 노출: ${id}`); }
  for (const c of s.clues ?? []) assert.ok(!pub.includes(c.text), `미공개 단서 노출: ${c.id}`);
});

test("http:// 이미지는 경고, https://는 경고 없음", () => {
  const warnOf = (url) => {
    const sc = sample(m);
    const scenes = sc.events ?? sc.scenes;
    Object.values(scenes)[0].image = url;
    const r = Engine.validateScenario(sc);
    assert.equal(r.errors.length, 0, r.errors.join("\n"));
    return r.warnings.some((w) => w.includes("http://"));
  };
  assert.equal(warnOf("http://a.b/c.png"), true);
  assert.equal(warnOf("https://a.b/c.png"), false);
});
