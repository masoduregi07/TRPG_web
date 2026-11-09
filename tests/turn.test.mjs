import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.mjs";

const { AI, Turn } = load();
const SECRET = "등대지기가 맡겨 둔 등대 열쇠를 갖고 있지만 먼저 말하지 않음";
const base = (over = {}) => ({
  skills: ["관찰력"], clues: ["c1"], checks: ["k1"], exits: ["next"], pending: [], pendingOwners: [],
  chars: [{ pid: "p1", name: "한서", player: "가", items: [] }], npcs: [], actors: [{ pid: "p1", name: "한서" }], askers: [],
  askOnly: false, handouts: [], npcNames: [], gotThisTurn: [], onlyFailedRolls: false, recentText: "",
  secrets: [{ kind: "NPC 비밀", text: SECRET }, { kind: "미공개 단서", clue: "c1", text: "벽장 안쪽 판자 뒤에 오래된 항해 일지가 숨겨져 있음" }], known: "",
  ...over,
});
const run = (obj, info = base(), final = false) => Turn.validate(AI.parseGM(JSON.stringify(obj)), info, { final });

test("leaks: 원문 그대로는 감지, 무관한 서술은 통과", () => {
  assert.ok(Turn.leaks("노인은 사실 등대 열쇠를 갖고 있음.", SECRET));
  assert.ok(!Turn.leaks("노인이 고개를 저음. 등대 쪽을 흘끗 봄.", SECRET));
  assert.ok(!Turn.leaks("노인은 사실 등대 열쇠를 갖고 있음.", SECRET, "등대 열쇠를 갖고 있음"), "이미 기록에 나온 내용은 제외");
});

test("비밀 노출: 첫 시도는 다시 요청, 마지막은 그 문장만 삭제", () => {
  const obj = { narration: "한서가 노인을 봄. 노인은 등대 열쇠를 갖고 있음. 바람이 붊." };
  const a = run(obj);
  assert.ok(a.issues.some((i) => i.hard && /비공개 정보/.test(i.msg)));
  assert.ok(!a.issues.some((i) => i.msg.includes("열쇠")), "경고문에 비밀 원문을 넣지 않음");
  const b = run(obj, base(), true);
  assert.ok(!b.issues.some((i) => i.hard));
  assert.equal(b.plan.narration, "한서가 노인을 봄. 바람이 붊.");
});

test("이번에 공개하는 단서 원문은 노출로 보지 않음", () => {
  const r = run({ narration: "한서가 벽장을 뒤짐. 판자 뒤에 오래된 항해 일지가 숨겨져 있음.", reveal_clue: "c1" });
  assert.equal(r.plan.clue, "c1");
  assert.ok(!r.issues.some((i) => /비공개/.test(i.msg)));
});

test("공개 안 하면서 단서 원문을 쓰면 노출", () => {
  const r = run({ narration: "한서가 벽장을 봄. 판자 뒤에 오래된 항해 일지가 숨겨져 있음." });
  assert.ok(r.issues.some((i) => i.hard && /미공개 단서/.test(i.msg)));
});

test("results · answers도 검사", () => {
  const r = run({ narration: "", answers: [{ to: "한서", text: "노인은 등대 열쇠를 갖고 있지만 숨김." }] }, base({ askOnly: true, askers: [{ pid: "p1", name: "한서" }], actors: [] }), true);
  assert.ok(r.plan.answers.every((a) => !a.text.includes("열쇠")));
});

test("없는 사건 이동 · 판정과 이동 동시 요청", () => {
  assert.equal(run({ narration: "한서가 걸음.", move_to: "nowhere" }).plan.move, null);
  const r = run({ narration: "한서가 문을 엶.", move_to: "next", request_check: { id: "k1", who: "한서" } });
  assert.ok(r.issues.some((i) => i.hard && /move_to/.test(i.msg)));
});

test("판정 전에 결과를 미리 서술하면 다시 요청", () => {
  const r = run({ narration: "한서가 자물쇠를 따는 데 성공함.", request_check: { id: "k1", who: "한서" } });
  assert.ok(r.issues.some((i) => i.hard));
});

test("빈 응답 · 형식 오류는 hard", () => {
  assert.ok(Turn.validate(AI.parseGM("아무 말"), base()).issues.some((i) => i.hard));
  assert.ok(run({ narration: "" }).issues.some((i) => i.hard));
});
