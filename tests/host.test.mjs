import test from "node:test";
import assert from "node:assert/strict";
import { load, sample } from "./load.mjs";

const KEY = "abcdefghijklmnop", KEY2 = "qrstuvwxyz012345";
function table() {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const sent = [], local = [];
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "human", scenario: sc });
  const g = new m.HostGame(data, { transport: { send: (c, msg) => sent.push([c, msg]), close: () => {} }, onLocal: (msg) => local.push(msg) });
  return { m, g, data, sent, local };
}
const to = (sent, c, t) => sent.filter(([x, msg]) => x === c && msg.t === t).map(([, msg]) => msg);

test("접속: 버전 · 키 형식 · 닉네임 확인", () => {
  const { m, g } = table();
  assert.equal(g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD - 1 }).ok, false);
  assert.equal(g.onConnect("c1", { key: "짧음", name: "가", build: m.APP_BUILD }).ok, false);
  assert.equal(g.onConnect("c1", { key: KEY, name: "", build: m.APP_BUILD }).ok, false);
  assert.equal(g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD }).ok, true);
});

test("같은 키로 재접속하면 같은 자리, 같은 이름은 번호 붙임", () => {
  const { m, g, data } = table();
  const a = g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  const b = g.onConnect("c2", { key: KEY, name: "가", build: m.APP_BUILD });
  assert.equal(a.pid, b.pid);
  const c = g.onConnect("c3", { key: KEY2, name: "가", build: m.APP_BUILD });
  assert.notEqual(c.pid, a.pid);
  assert.equal(data.players[c.pid].name, "가2");
});

test("최대 인원 넘으면 거절", () => {
  const { m, g } = table();
  for (let i = 0; i < 3; i++) assert.equal(g.onConnect(`c${i}`, { key: `key${i}`.padEnd(16, "x"), name: `p${i}`, build: m.APP_BUILD }).ok, true);
  assert.equal(g.onConnect("c9", { key: "key9".padEnd(16, "x"), name: "p9", build: m.APP_BUILD }).ok, false);
});

test("참가자는 호스트 전용 명령을 못 씀", () => {
  const { m, g, data, sent } = table();
  g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  g.onMessage("c1", { t: "start" });
  g.onMessage("c1", { t: "emergencyNarrate", text: "가짜 GM" });
  assert.equal(data.phase, "lobby");
  assert.ok(!data.log.some((e) => e.kind === "gm"));
});

test("잘못된 메시지 · 폭주는 무시하고 호스트는 계속 동작", () => {
  const { m, g, data } = table();
  g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  for (const bad of [null, 1, "x", { t: 5 }, { t: "char", character: null }, { t: "mapMove", x: "NaN" }, { t: "hp", pid: "없음" }]) assert.doesNotThrow(() => g.onMessage("c1", bad));
  for (let i = 0; i < 40; i++) g.onMessage("c1", { t: "lobbyChat", text: `말 ${i}` });
  assert.ok((data.lobbyChat ?? []).length <= 25, "5초에 25개 넘는 메시지는 버림");
});

test("특성치 굴림 → 캐릭터 저장 → 준비", () => {
  const { m, g, data } = table();
  const { pid } = g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  g.onMessage("c1", { t: "rollChars" });
  assert.ok(data.players[pid].cocRoll?.chars);
  const bg = m.Engine.charRules(data.scenario).backgrounds[0]?.name ?? "";
  g.onMessage("c1", { t: "char", character: { name: "한서", background: bg, alloc: {} }, ready: true });
  assert.equal(data.players[pid].character?.name, "한서");
  assert.equal(data.players[pid].ready, true);
  // 굴린 특성치는 플레이어가 못 바꿈
  g.onMessage("c1", { t: "char", character: { name: "한서", background: bg, alloc: {}, chars: { 근력: 99 } } });
  assert.notEqual(data.players[pid].character.chars["근력"], 99);
});

test("남의 비밀 · 목표는 스냅샷에 안 감", () => {
  const { m, g, data, sent } = table();
  const a = g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  const b = g.onConnect("c2", { key: KEY2, name: "나", build: m.APP_BUILD });
  data.players[a.pid].character = { name: "한서", goal: "몰래 금고를 연다", secret: "사실 밀수꾼" };
  g.pushAll();
  const snap = to(sent, "c2", "snap").at(-1);
  const s = JSON.stringify(snap);
  assert.ok(!s.includes("몰래 금고를 연다") && !s.includes("사실 밀수꾼"));
});

test("비밀 굴림(/sr)은 본인과 호스트만", () => {
  const { m, g, data, sent } = table();
  const a = g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  const b = g.onConnect("c2", { key: KEY2, name: "나", build: m.APP_BUILD });
  const e = g.addLog({ kind: "roll", byId: a.pid, by: "가", text: "비밀", secret: true });
  assert.ok(g.visible(e, a.pid));
  assert.ok(!g.visible(e, b.pid));
  assert.ok(g.visible(e, data.hostPid));
});

test("askGM: 비밀을 흘리면 다시 묻고, 두 번째도 흘리면 그 문장 삭제", async () => {
  const { m, g } = table();
  const replies = [
    JSON.stringify({ narration: "노인이 웃음. 노인은 등대 열쇠를 갖고 있음." }),
    JSON.stringify({ narration: "노인이 웃음. 사실 등대 열쇠를 갖고 있음. 파도가 침." }),
  ];
  const asked = [];
  g.aiCall = async (messages) => { asked.push(messages); return replies[asked.length - 1]; };
  const SECRET = "등대지기가 맡겨 둔 등대 열쇠를 갖고 있지만 먼저 말하지 않음";
  const info = { skills: [], clues: [], checks: [], exits: [], pending: [], pendingOwners: [], chars: [], npcs: [], actors: [], askers: [], askOnly: false,
    handouts: [], npcNames: [], gotThisTurn: [], onlyFailedRolls: false, recentText: "", secrets: [{ kind: "NPC 비밀", text: SECRET }], known: "" };
  const plan = await g.askGM({ ctx: {}, info, recent: [] });
  assert.equal(asked.length, 2);
  assert.match(asked[1].at(-1).content, /비공개 정보/);
  assert.equal(plan.narration, "노인이 웃음. 파도가 침.");
});

test("turnContext: 판정 공개 단서 · 문체 · 판정만 차례 정보", () => {
  const { m, g, data } = table();
  const { pid } = g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  g.onMessage("c1", { t: "rollChars" });
  const bg = m.Engine.charRules(data.scenario).backgrounds[0]?.name ?? "";
  g.onMessage("c1", { t: "char", character: { name: "한서", background: bg, alloc: {} }, ready: true });
  g.handle(data.hostPid, { t: "start" }, true);
  assert.equal(data.phase, "play");
  const { info, ctx } = g.turnContext();
  assert.ok(info.checkReveals.some((x) => x.check === "persuade_fisherman" && x.clue === "daughter"));
  assert.equal(info.tone, "nominal");
  assert.equal(info.rollOnly, false);
  assert.ok(ctx.가능한판정.some((c) => c.id === "persuade_fisherman" && c.성공시공개단서 === "daughter"));
});

test("진행 중 합류해 기록지를 쓰는 중이면 채팅 무시", () => {
  const { m, g, data, sent } = table();
  const a = g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  g.onMessage("c1", { t: "rollChars" });
  const bg = m.Engine.charRules(data.scenario).backgrounds[0]?.name ?? "";
  g.onMessage("c1", { t: "char", character: { name: "한서", background: bg, alloc: {} }, ready: true });
  g.handle(data.hostPid, { t: "start" }, true);
  assert.equal(data.phase, "play");
  const b = g.onConnect("c2", { key: KEY2, name: "나", build: m.APP_BUILD });
  const n = data.log.length;
  g.onMessage("c2", { t: "chat", text: "*문을 연다" });
  g.onMessage("c2", { t: "chat", text: "/r d100" });
  assert.equal(data.log.length, n, "준비 전 입력은 기록에 안 남음");
  g.onMessage("c1", { t: "chat", text: "*문을 연다" });
  assert.ok(data.log.length > n, "준비된 플레이어는 그대로");
});
