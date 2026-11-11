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

test("turnContext: 굴림 + 일행 잡담만 있으면 판정만 차례, 행동 선언이 있으면 아님", () => {
  const { m, g, data } = table();
  const { pid } = g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  g.onMessage("c1", { t: "rollChars" });
  const bg = m.Engine.charRules(data.scenario).backgrounds[0]?.name ?? "";
  g.onMessage("c1", { t: "char", character: { name: "한서", background: bg, alloc: {} }, ready: true });
  g.handle(data.hostPid, { t: "start" }, true);
  g.addLog({ kind: "roll", byId: pid, by: "한서", text: "설득", result: "보통 성공" });
  g.addLog({ kind: "say", byId: pid, by: "한서", text: "안녕", style: "talk" });
  assert.equal(g.turnContext().info.rollOnly, true);
  g.addLog({ kind: "say", byId: pid, by: "한서", text: "등대로 간다", style: "act" });
  assert.equal(g.turnContext().info.rollOnly, false);
});

test("결과 정리에 결말 장면 묘사(endingText)", () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "h".repeat(24), hostPlays: true, mode: "human", scenario: sc });
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {} });
  data.phase = "play";
  const r = g.sessionResult();
  assert.equal(typeof r.endingText, "string");
  assert.equal(r.endingText, String(sc.scenes[data.game.currentScene]?.description ?? "").trim().slice(0, 600));
});

test("참가 전 명단 미리 보기: 이름·캐릭터만, 물어본 사람 자리는 빼고 GM 표시", () => {
  const { m, g, data } = table();
  const a = g.onConnect("c1", { key: KEY, name: "루나", build: m.APP_BUILD }).pid;
  g.onConnect("c2", { key: KEY2, name: "서진", build: m.APP_BUILD });
  data.players[a].character = { name: "엘리너" };
  const all = JSON.parse(JSON.stringify(g.rosterPreview()));
  assert.deepEqual(all.map((p) => [p.name, p.char, p.gm, p.writing]), [["호스트", "", true, false], ["루나", "엘리너", false, false], ["서진", "", false, true]]);
  assert.ok(all.every((p) => !("key" in p) && !("secret" in p)));
  assert.deepEqual(JSON.parse(JSON.stringify(g.rosterPreview(KEY2))).map((p) => p.name), ["호스트", "루나"]);
});

test("참가자 id는 숫자로만 되지 않음 (명단 순서 = 들어온 순서)", () => {
  const { m, g, data } = table();
  for (let i = 0; i < 300; i++) assert.match(m.randomPid(), /^[a-z][a-z0-9]{7}$/);
  g.onConnect("c1", { key: KEY, name: "루나", build: m.APP_BUILD });
  assert.deepEqual(Object.values(data.players).map((p) => p.name), ["호스트", "루나"]);
});

test("turnContext: 이름 미정 KPC · 직전 NPC 대사", () => {
  const m = load();
  const sc = sample(m);
  sc.scenes[sc.start].description += " 동료 KPC가 함께 있음.";
  m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "human", scenario: sc });
  const g = new m.HostGame(data, { transport: { send: () => {}, close: () => {} } });
  g.onConnect("c1", { key: KEY, name: "가", build: m.APP_BUILD });
  g.onMessage("c1", { t: "rollChars" });
  const bg = m.Engine.charRules(data.scenario).backgrounds[0]?.name ?? "";
  g.onMessage("c1", { t: "char", character: { name: "한서", background: bg, alloc: {} }, ready: true });
  g.handle(data.hostPid, { t: "start" }, true);
  let { info, ctx } = g.turnContext();
  assert.equal(info.kpcOpen, true);
  assert.ok(ctx.등장NPC.some((n) => n.id === "kpc" && n.이름미정));
  g.addLog({ kind: "ai", text: "남자가 다가옴. \"조심해서 안으로 들어가 보죠.\"" });
  data.game.aiCursor = data.logSeq;
  ({ info, ctx } = g.turnContext());
  assert.equal(JSON.stringify(info.prevQuotes), JSON.stringify(["\"조심해서 안으로 들어가 보죠.\""]));
  assert.equal(ctx.직전NPC대사, info.prevQuotes);
  m.Engine.registerNpc(data.scenario, data.game.currentScene, { name: "바르톨", look: "늙은 어부", personality: "무뚝뚝", voice: "말끝을 흐림" });
  g.addLog({ kind: "ai", text: "바르톨이 그물을 내려놓음. \"모르겠수.\"" });
  data.game.aiCursor = data.logSeq;
  ({ info, ctx } = g.turnContext());
  assert.equal(JSON.stringify(info.npcRecent.바르톨), JSON.stringify(["\"모르겠수.\""]));
  assert.ok(ctx.등장NPC.some((n) => n.이름 === "바르톨" && n.말투 === "말끝을 흐림"));
  assert.ok(ctx.등장NPC.some((n) => n.id === "kpc" && /동료/.test(n.역할)));
  m.Engine.registerNpc(data.scenario, data.game.currentScene, { id: "kpc", name: "한진우", look: "코트", personality: "차분" });
  assert.equal(g.turnContext().info.kpcOpen, false, "이름이 정해지면 끝");
});

test("KPC는 사건이 바뀌어도 따라오고, kpcAway면 따라 넣은 사건에서만 빠짐", () => {
  const m = load();
  const sc = sample(m);
  sc.npcs.kpc = { name: "한은우", look: "코트", personality: "신중" };
  sc.scenes[sc.start].npcs = [...(sc.scenes[sc.start].npcs ?? []), "kpc"];
  m.Engine.validateScenario(sc);
  const st = m.Engine.newState(sc);
  const other = Object.keys(sc.scenes).find((id) => id !== sc.start && !sc.scenes[id].ending);
  st.currentScene = other;
  m.Engine.kpcFollow(sc, st);
  assert.ok(sc.scenes[other].npcs.includes("kpc"));
  sc.scenes[other].npcs = sc.scenes[other].npcs.filter((x) => x !== "kpc"); sc.scenes[other].kpc = false;
  m.Engine.kpcFollow(sc, st);
  assert.ok(!sc.scenes[other].npcs.includes("kpc"), "kpc: false인 사건엔 안 들어감");
  sc.scenes[other].kpc = true;
  m.Engine.kpcFollow(sc, st);
  assert.ok(sc.scenes[other].npcs.includes("kpc"));
  st.kpcAway = true;
  m.Engine.kpcFollow(sc, st);
  assert.ok(!sc.scenes[other].npcs.includes("kpc"), "따라 넣은 사건에선 빠짐");
  assert.ok(sc.scenes[sc.start].npcs.includes("kpc"), "시나리오가 둔 사건엔 일반 NPC로 남음");
  const ctx = m.Engine.aiContext(sc, { ...st, currentScene: sc.start }, []);
  assert.match(ctx.등장NPC.find((n) => n.id === "kpc").역할, /일반 NPC/);
  delete st.kpcFollowed;   // 예전 세이브: 모든 사건에서 뺌
  m.Engine.kpcFollow(sc, st);
  assert.ok(!Object.values(sc.scenes).some((s) => (s.npcs ?? []).includes("kpc")));
});

test("NPC 설정 카드: YAML 칸이 먼저, 빈 칸은 AI 카드 · 맥락에 들어감 · 비밀 겹치는 줄은 뺌", () => {
  const m = load();
  const sc = sample(m);
  m.Engine.validateScenario(sc);
  const st = m.Engine.newState(sc);
  const id = m.Engine.sceneOf(sc, st).npcs[0];
  sc.npcs[id].lines = ["이 바다는 사람을 가려 받수."];
  assert.ok(m.Engine.npcCardTodo(sc, st).includes(id), "빈 칸이 있으면 만들 대상");
  st.npcCards = { [id]: { knows: ["삼십 년째 이 항구에서 그물을 손질함"], wants: "딸 소식을 듣고 싶음", relations: [], lines: ["AI 대사"] } };
  assert.ok(!m.Engine.npcCardTodo(sc, st).includes(id), "카드가 있으면 다시 안 만듦");
  const c = m.Engine.npcCard(sc, st, id);
  assert.deepEqual([...c.lines], ["이 바다는 사람을 가려 받수."], "YAML이 먼저");
  assert.equal(c.knows.length, 1);
  const npc = m.Engine.aiContext(sc, st, []).등장NPC.find((n) => n.id === id);
  assert.equal(npc.바라는것, "딸 소식을 듣고 싶음");
  assert.ok(npc.아는것 && npc.예시대사);
  const card = m.AI.parseNpcCard(JSON.stringify({ knows: ["등대지기가 맡겨 둔 등대 열쇠를 갖고 있음", "밤바다엔 노랫소리가 들린다는 소문"], wants: "조용히 늙는 것", relations: "x", lines: ["허허."] }));
  const safe = m.HostGame.safeCard(card, ["등대지기가 맡겨 둔 등대 열쇠를 갖고 있지만 먼저 말하지 않음"]);
  assert.deepEqual([...safe.knows], ["밤바다엔 노랫소리가 들린다는 소문"]);
  assert.deepEqual([...safe.relations], ["x"]);
});
