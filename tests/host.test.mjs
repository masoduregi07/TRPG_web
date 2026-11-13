import test from "node:test";
import assert from "node:assert/strict";
import { load, sample } from "./load.mjs";

const KEY = "abcdefghijklmnop", KEY2 = "qrstuvwxyz012345";
function table(extra = {}) {
  const m = load(extra);
  const sc = sample(m); m.Engine.validateScenario(sc);
  const sent = [], local = [];
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "human", scenario: sc });
  const g = new m.HostGame(data, { transport: { send: (c, msg) => sent.push([c, msg]), close: () => {} }, onLocal: (msg) => local.push(msg) });
  return { m, g, data, sent, local };
}
const to = (sent, c, t) => sent.filter(([x, msg]) => x === c && msg.t === t).map(([, msg]) => msg);

test("AI 출력이 두 번 잘리면 4,000 토큰으로 한 번 더 요청", async () => {
  const { g } = table({ setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {} });
  const limits = [];
  g.aiCall = async (_messages, { maxTokens }) => {
    limits.push(maxTokens);
    if (limits.length < 3) {
      const error = new Error("AI 응답이 출력 한도에서 잘림.");
      error.truncated = true;
      throw error;
    }
    return "완료";
  };

  assert.equal(await g.callAI([]), "완료");
  assert.deepEqual(limits, [1200, 2400, 4000]);
});

test("AI 출력이 4,000 토큰에서도 잘리면 추가 호출 없이 종료", async () => {
  const { g } = table({ setTimeout: (fn) => globalThis.setTimeout(fn, 0), clearTimeout: globalThis.clearTimeout });
  const limits = [];
  g.aiCall = async (_messages, { maxTokens }) => {
    limits.push(maxTokens);
    const error = new Error("AI 응답이 출력 한도에서 잘림.");
    error.truncated = true;
    throw error;
  };

  await assert.rejects(g.callAI([]), (error) => error.truncated === true);
  assert.deepEqual(limits, [1200, 2400, 4000]);
});

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

test("askGM: 비밀을 흘리면 다시 묻고(두 번까지), 세 번째도 흘리면 그 문장 삭제", async () => {
  const { m, g } = table();
  const replies = [
    JSON.stringify({ narration: "노인이 웃음. 노인은 등대 열쇠를 갖고 있음." }),
    JSON.stringify({ narration: "노인이 웃음. 등대 열쇠를 갖고 있음. 바람이 붊." }),
    JSON.stringify({ narration: "노인이 웃음. 사실 등대 열쇠를 갖고 있음. 파도가 침." }),
  ];
  const asked = [];
  g.aiCall = async (messages) => { asked.push(messages); return replies[asked.length - 1]; };
  const SECRET = "등대지기가 맡겨 둔 등대 열쇠를 갖고 있지만 먼저 말하지 않음";
  const info = { skills: [], clues: [], checks: [], exits: [], pending: [], pendingOwners: [], chars: [], npcs: [], actors: [], askers: [], askOnly: false,
    handouts: [], npcNames: [], gotThisTurn: [], onlyFailedRolls: false, recentText: "", secrets: [{ kind: "NPC 비밀", text: SECRET }], known: "" };
  const plan = await g.askGM({ ctx: {}, info, recent: [] });
  assert.equal(asked.length, 3);
  assert.match(asked[1].at(-1).content, /비공개 정보/);
  assert.match(asked[2].at(-1).content, /비공개 정보/);
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

test("NPC 설정 카드: YAML에 AI 카드를 겹침 · 이야기 중 바뀜 · 맥락에 들어감 · 비밀 겹치는 줄은 뺌", () => {
  const m = load();
  const sc = sample(m);
  m.Engine.validateScenario(sc);
  const st = m.Engine.newState(sc);
  const id = m.Engine.sceneOf(sc, st).npcs[0];
  sc.npcs[id].lines = ["이 바다는 사람을 가려 받수."];
  assert.ok(m.Engine.npcCardTodo(sc, st).includes(id), "빈 칸이 있으면 만들 대상");
  st.npcCards = { [id]: { knows: ["삼십 년째 이 항구에서 그물을 손질함"], wants: "딸 소식을 듣고 싶음", relations: [], lines: ["AI 대사"], gen: true } };
  assert.ok(!m.Engine.npcCardTodo(sc, st).includes(id), "AI가 만들었으면 다시 안 만듦");
  const c = m.Engine.npcCard(sc, st, id);
  assert.deepEqual([...c.lines], ["이 바다는 사람을 가려 받수.", "AI 대사"], "예시 대사는 YAML이 먼저");
  assert.equal(c.knows.length, 1);
  // 이야기 중 바뀜: YAML 바람 · 관계도 덮어씀
  sc.npcs[id].wants = "조용히 늙는 것"; sc.npcs[id].relations = ["그레고르 — 경멸함"];
  m.Engine.npcCardUpdate(st, id, { knows: ["한서가 등대 열쇠 이야기를 꺼냄"], wants: "등대에 다시 불을 켜고 싶음", relations: ["그레고르 — 같이 배를 탈 뻔했던 사이"] });
  const c2 = m.Engine.npcCard(sc, st, id);
  assert.equal(c2.wants, "등대에 다시 불을 켜고 싶음");
  assert.deepEqual([...c2.relations], ["그레고르 — 같이 배를 탈 뻔했던 사이"]);
  assert.equal(c2.knows.at(-1), "한서가 등대 열쇠 이야기를 꺼냄");
  delete sc.npcs[id].wants; delete sc.npcs[id].relations;
  const ax = m.HostGame.cardAxes(() => 0);
  assert.ok(ax.말빠르기 && ax.말수 && ax.관심사 && ax.버릇);
  st.npcCards[id].wants = "딸 소식을 듣고 싶음";
  const npc = m.Engine.aiContext(sc, st, []).등장NPC.find((n) => n.id === id);
  assert.equal(npc.바라는것, "딸 소식을 듣고 싶음");
  assert.ok(npc.아는것 && npc.예시대사);
  const card = m.AI.parseNpcCard(JSON.stringify({ knows: ["등대지기가 맡겨 둔 등대 열쇠를 갖고 있음", "밤바다엔 노랫소리가 들린다는 소문"], wants: "조용히 늙는 것", relations: "x", lines: ["허허."] }));
  const safe = m.HostGame.safeCard(card, ["등대지기가 맡겨 둔 등대 열쇠를 갖고 있지만 먼저 말하지 않음"]);
  assert.deepEqual([...safe.knows], ["밤바다엔 노랫소리가 들린다는 소문"]);
  assert.deepEqual([...safe.relations], ["x"]);
});

test("NPC 카드: 한 번 요청으로 여러 명 · GM이 바쁘면 안 만듦 · 못 만든 NPC는 다시 안 함", async () => {
  const m = load();
  const out = m.AI.parseNpcCards(JSON.stringify({ cards: [{ id: "a", knows: ["x"], lines: ["y"] }, { id: "b", wants: "z" }, { id: "zz", wants: "?" }] }), ["a", "b"]);
  assert.deepEqual(Object.keys(out).sort(), ["a", "b"]);
  const sc = sample(m); m.Engine.validateScenario(sc);
  const s0 = sc.scenes[sc.start]; sc.npcs.o1 = { name: "오스카", look: "x", personality: "y" }; s0.npcs.push("o1");
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "ai", scenario: sc });
  const asked = [];
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {}, aiCall: async (msgs) => {
    asked.push(msgs[1].content);
    return JSON.stringify({ cards: [{ id: s0.npcs[0], knows: ["삼십 년째 고기잡이"], lines: ["허허."] }] });
  } });
  data.phase = "play"; data.game = m.Engine.newState(sc); g.aiReady = () => true;
  g.ai.busy = true;
  assert.equal(g.ensureNpcCards(), null, "GM 차례 중엔 안 만듦");
  g.ai.busy = false;
  await g.ensureNpcCards();
  assert.equal(asked.length, 1, "한 번 요청");
  assert.match(asked[0], /오스카/);
  assert.ok(data.game.npcCards[s0.npcs[0]].gen);
  assert.deepEqual([...data.game.npcCardFail], ["o1"], "응답에 없던 NPC는 실패로");
  assert.equal(g.ensureNpcCards(), null, "다시 안 함");
});

test("판정 여러 개 적용 · NPC 대사의 질문자 기록", async () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "ai", scenario: sc });
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {}, aiCall: async () => "{}" });
  data.phase = "play"; data.game = m.Engine.newState(sc);
  data.players.p1 = { name: "가", ready: true, character: { name: "한서" } };
  data.players.p2 = { name: "나", ready: true, character: { name: "민준" } };
  g.applyPlan({ narration: "둘이 각자 살핌.", answers: [], give: [], take: [], hurt: [], heal: [], blocks: [], newNpcs: [], showHandouts: [],
    checks: [{ type: "improv", spec: { skill: "관찰력", reason: "벽 살피기" }, who: "p1", whoName: "한서" }, { type: "improv", spec: { skill: "듣기", reason: "소리 듣기" }, who: "p2", whoName: "민준" }] });
  assert.equal(data.game.pendingChecks.length, 2);
});

function aiTable(aiCall) {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "ai", scenario: sc });
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {}, aiCall, aiDebounceMs: 100000 });
  const seat = (c, key, name, ch) => {
    const { pid } = g.onConnect(c, { key, name, build: m.APP_BUILD });
    g.onMessage(c, { t: "rollChars" });
    g.onMessage(c, { t: "char", character: { name: ch, background: m.Engine.charRules(sc).backgrounds[0]?.name ?? "", alloc: {} }, ready: true });
    return pid;
  };
  return { m, g, data, sc, seat, stop: () => { clearTimeout(g.ai.timer); g.ai.timer = null; } };
}

test("다인 차례: @NPC 대사 · 판정 굴림을 한 캐릭터의 결과도 남음", async () => {
  let reply = "";
  const t = aiTable(async () => reply);
  t.seat("c1", KEY, "가", "한서"); t.seat("c2", KEY2, "나", "도윤");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  t.g.onMessage("c1", { t: "chat", text: "선반을 뒤진다", style: "act" });
  t.g.onMessage("c2", { t: "chat", text: "@바르톨 그날 밤에 누굴 봤습니까?", style: "talk" });
  t.stop();
  reply = JSON.stringify({ narration: "", results: [{ who: "한서", text: "먼지 쌓인 장부가 드러남." }, { who: "도윤", text: '바르톨이 고개를 저음. "그날 밤엔 아무도 못 봤소."' }] });
  await t.g.runAI();
  assert.deepEqual([...t.data.log.filter((e) => e.kind === "ai").map((e) => e.focus)], ["한서", "도윤"]);
  // 판정 굴림 + 다른 사람 행동
  t.g.hostAction({ t: "requestCheck", checkId: "persuade_fisherman" });
  t.g.onMessage("c1", { t: "check", checkId: "persuade_fisherman" });
  t.g.onMessage("c2", { t: "chat", text: "부두 끝의 배를 살펴본다", style: "act" });
  t.stop();
  reply = JSON.stringify({ narration: "", results: [{ who: "한서", text: "바르톨이 그물만 만지작거림." }, { who: "도윤", text: "배 안엔 젖은 밧줄뿐임." }] });
  await t.g.runAI();
  assert.deepEqual([...t.data.log.filter((e) => e.kind === "ai").slice(-2).map((e) => e.focus)], ["한서", "도윤"]);
});

// 행운으로 메울 수 있는 즉흥 판정 실패가 나올 때까지 굴림
function failUntilRetry(t, pid, conn, skill = "민첩") {
  const c = t.data.players[pid].character; c.luck = 99; c.chars[skill] = 40;
  for (let i = 0; i < 300; i++) {
    t.g.requestImprov({ skill, reason: "창틀 넘기" }, { who: pid, whoName: c.name });
    t.g.onMessage(conn, { t: "check", checkId: t.data.game.pendingChecks.at(-1).checkId });
    if (t.data.game.retries?.[pid]?.luckCost > 0) return;
    t.g.invalidateAI(); t.g.rate.clear(); delete t.data.game.retries?.[pid];
  }
  throw new Error("실패가 안 나옴");
}

test("실패한 사람이 밀어붙이기 · 행운을 고를 때까지 AI GM은 서술하지 않음 → 행운으로 성공하면 성공으로 서술", async () => {
  let calls = 0; const asked = [];
  const t = aiTable(async (msgs) => { calls++; asked.push(msgs[1].content); return JSON.stringify({ narration: "창틀을 넘어 안으로 들어섬." }); });
  const pid = t.seat("c1", KEY, "가", "한서");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  failUntilRetry(t, pid, "c1");
  t.stop(); await new Promise((r) => setTimeout(r, 20)); calls = 0; asked.length = 0;
  await t.g.runAI();
  assert.equal(calls, 0, "고르는 중엔 AI 요청 안 함");
  assert.ok(t.g.ai.hold, "다시 볼 타이머");
  t.g.rate.clear(); t.g.onMessage("c1", { t: "luck" });
  clearTimeout(t.g.ai.hold); t.g.ai.hold = null; t.stop();
  await t.g.runAI();
  assert.equal(calls, 1);
  assert.match(asked[0], /행운 \d+ 써서 성공/);
  assert.equal(Object.keys(t.data.game.retries).length, 0);
});

test("밀어붙이기 대기: 30초 지나면 넘긴 것으로 보고 서술 · 접속이 끊긴 사람은 기다리지 않음", async () => {
  let calls = 0;
  const t = aiTable(async () => { calls++; return JSON.stringify({ narration: "창틀에서 미끄러짐." }); });
  const pid = t.seat("c1", KEY, "가", "한서");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  failUntilRetry(t, pid, "c1");
  t.data.game.retryFrom -= t.m.HostGame.RETRY_WAIT + 1;   // 시간 다 됨
  t.stop(); await new Promise((r) => setTimeout(r, 20)); calls = 0;
  await t.g.runAI();
  assert.equal(calls, 1);
  assert.equal(t.data.game.retries[pid], undefined);
  // 끊긴 사람: 기회는 남지만 기다리지 않음
  t.g.invalidateAI(); t.g.rate.clear();
  failUntilRetry(t, pid, "c1");
  t.g.online = () => false;
  assert.equal(t.g.retryHold(), 0);
  assert.ok(t.data.game.retries[pid]);
  clearTimeout(t.g.ai.hold); t.stop();
});

test("[넘기기] · [지금 진행]: 밀어붙이기 대기를 끝내고 바로 서술", async () => {
  let calls = 0;
  const t = aiTable(async () => { calls++; return JSON.stringify({ narration: "창틀에서 미끄러짐." }); });
  const pid = t.seat("c1", KEY, "가", "한서");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  failUntilRetry(t, pid, "c1");
  t.g.rate.clear(); t.g.onMessage("c1", { t: "skipRetry" });
  assert.equal(t.data.game.retries[pid], undefined, "넘기면 기회 끝");
  // 다시 실패 → 대기 중에 [지금 진행]
  t.g.invalidateAI(); t.g.rate.clear();
  failUntilRetry(t, pid, "c1");
  t.stop(); await t.g.runAI();
  assert.ok(t.g.ai.hold);
  t.g.rate.clear(); t.g.onMessage("c1", { t: "aiNow" });
  assert.equal(t.g.ai.hold, null);
  assert.equal(Object.keys(t.data.game.retries).length, 0);
  clearTimeout(t.g.ai.timer); t.g.ai.timer = null;
});

test("밀어붙이기 기회는 사람마다: 남이 굴려도 내 기회는 남고, 같은 판정을 남이 성공하면 끝", () => {
  const t = aiTable(async () => "{}");
  const a = t.seat("c1", KEY, "가", "한서"), b = t.seat("c2", KEY2, "나", "도윤");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  failUntilRetry(t, a, "c1");
  const before = t.data.game.retries[a];
  t.g.rate.clear(); t.g.requestImprov({ skill: "민첩", reason: "뛰어넘기" }, { who: b, whoName: "도윤" });
  t.g.onMessage("c2", { t: "check", checkId: t.data.game.pendingChecks.at(-1).checkId });
  assert.equal(t.data.game.retries[a], before, "남의 굴림은 내 기회를 안 지움");
  // 시나리오 판정을 a가 실패 → b가 같은 판정 성공하면 a의 기회는 끝
  t.data.game.retries = { [a]: { pid: a, spec: { label: "x" }, checkId: "chk1", rollId: "r", pushable: true, luckCost: 0, at: Date.now() } };
  t.g.dropRetriesFor("chk1");
  assert.equal(Object.keys(t.data.game.retries).length, 0);
  t.stop();
});

test("대기 창은 차례마다 하나: 뒤에 실패한 사람도 첫 실패 시각 기준으로 함께 끝남 · 서술하면 창도 끝", async () => {
  const t = aiTable(async () => JSON.stringify({ narration: "창틀에서 미끄러짐." }));
  const a = t.seat("c1", KEY, "가", "한서"), b = t.seat("c2", KEY2, "나", "도윤");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  failUntilRetry(t, a, "c1");
  const from = t.data.game.retryFrom;
  assert.ok(from > 0);
  t.data.game.retryFrom = from - 20000;   // 20초 지난 뒤 b가 실패
  t.g.rate.clear(); failUntilRetry(t, b, "c2");
  assert.equal(t.data.game.retryFrom, from - 20000, "창이 늘지 않음");
  const hold = t.g.retryHold();
  assert.ok(hold > 0 && hold <= t.m.HostGame.RETRY_WAIT - 20000 + 50, `남은 대기 ${hold}`);
  t.data.game.retryFrom -= t.m.HostGame.RETRY_WAIT;
  assert.equal(t.g.retryHold(), 0);
  assert.equal(Object.keys(t.data.game.retries).length, 0, "둘 다 넘긴 것으로");
  assert.equal(t.data.game.retryFrom, undefined);
  clearTimeout(t.g.ai.hold); clearTimeout(t.g.ai.timer); t.stop();
});

test("예전 저장본의 game.retry는 사람별 retries로 옮김", () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "ai", scenario: sc });
  data.game = m.Engine.newState(sc);
  data.game.retry = { pid: "p1", spec: { label: "x" }, checkId: null, rollId: "r", pushable: true, luckCost: 3 };
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {} });
  assert.equal(data.game.retry, undefined);
  assert.equal(data.game.retries.p1.luckCost, 3);
  assert.ok(data.game.retries.p1.at > 0);
  clearTimeout(g.ai.timer);
});

test("NPC 카드: 호출 오류는 실패로 안 적고 1분 뒤 다시, 3번 연속이면 포기", async () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "ai", scenario: sc });
  let calls = 0;
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {}, aiCall: async () => { calls++; const e = new Error("AI GM이 지친 모양입니다."); e.tired = true; throw e; } });
  data.phase = "play"; data.game = m.Engine.newState(sc); g.aiReady = () => true;
  await g.ensureNpcCards();
  assert.equal(calls, 1);
  assert.ok(!data.game.npcCardFail?.length, "한 번 오류로 실패 처리 안 함");
  assert.equal(g.ensureNpcCards(), null, "바로 다시 부르지 않음");
  for (let i = 0; i < 2; i++) { g.npcCardRetryAt = 0; await g.ensureNpcCards(); }
  assert.equal(calls, 3);
  assert.ok(data.game.npcCardFail?.length, "3번 연속 오류면 포기");
});

test("문답 맴돎: 변화 없는 서술이 네 차례 이어지면 정체시진행에 매듭 안내, 판정이 걸리면 다시 셈 · 최근NPC몸짓 맥락", () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "ai", scenario: sc });
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {}, aiCall: async () => "{}" });
  data.phase = "play"; data.game = m.Engine.newState(sc);
  data.players.p1 = { name: "가", ready: true, character: { name: "한서" } };
  const npc = sc.npcs[sc.scenes[sc.start].npcs[0]].name;
  const plan = (over = {}) => ({ narration: `${npc}이 한숨을 쉬었다. "글쎄요."`, answers: [], give: [], take: [], hurt: [], heal: [], blocks: [], newNpcs: [], showHandouts: [], onTrack: true, ...over });
  const turn = (p) => { g.applyPlan(p); data.game.aiCursor = data.logSeq; };
  for (let i = 0; i < 3; i++) turn(plan());
  assert.equal(g.turnContext().ctx.정체시진행, "정상 진행");
  turn(plan());
  const { ctx, info } = g.turnContext();
  assert.match(ctx.정체시진행, /문답만 이어짐/);
  assert.equal(JSON.stringify(info.npcGestures[npc]), JSON.stringify([["한숨"], ["한숨"], ["한숨"]]), "그 NPC가 나온 최근 서술 3개");
  assert.equal(JSON.stringify(ctx.최근NPC몸짓[npc]), JSON.stringify(["한숨"]));
  turn(plan());
  assert.equal(g.turnContext().ctx.정체시진행, "정상 진행", "안내를 준 뒤에는 다시 셈");
  for (let i = 0; i < 2; i++) turn(plan());
  turn(plan({ checks: [{ type: "improv", spec: { skill: "관찰력", reason: "살피기" }, who: "p1", whoName: "한서" }], check: { type: "improv" } }));
  assert.equal(data.game.loopTurns, 0);
});

test("askGM: 캐릭터 말을 옮겨 쓴 서술 · 되풀이한 몸짓이면 이유를 붙여 다시 묻고 고친 응답을 씀", async () => {
  const { g } = table();
  const replies = [
    JSON.stringify({ narration: "어두운 예배당 안에서 한진우에게 어두워서 무언가를 하기 어렵다고 말을 건넸다." }),
    JSON.stringify({ narration: "한진우가 성냥갑을 흔들어 보았다. \"세 개비 남았어요. 아껴 써야겠는데요.\"" }),
    JSON.stringify({ narration: "한진우는 안경을 고쳐 쓰며 천장을 올려다보았다. \"위에서 뭔가 떨어졌어요.\"" }),
    JSON.stringify({ narration: "한진우가 어깨에 묻은 것을 손등으로 훔쳤다. \"위에서 뭔가 떨어졌어요. 끈적한데요.\"" }),
  ];
  const asked = [];
  g.aiCall = async (messages) => { asked.push(messages); return replies[asked.length - 1]; };
  const info = { skills: [], clues: [], checks: [], exits: [], pending: [], pendingOwners: [], chars: [{ pid: "p1", name: "김나윤", player: "가", items: [] }], npcs: [], actors: [], askers: [], order: ["p1"], askOnly: false,
    handouts: [], npcNames: ["한진우"], gotThisTurn: [], onlyFailedRolls: false, recentText: "", secrets: [], known: "", tone: "prose", askNpc: ["한진우"], npcGestures: { 한진우: [["안경을 고쳐 씀"], []] } };
  let plan = await g.askGM({ ctx: {}, info, recent: [] });
  assert.match(asked[1].at(-1).content, /규칙 10/);
  assert.match(plan.narration, /세 개비/);
  plan = await g.askGM({ ctx: {}, info, recent: [] });
  assert.match(asked[3].at(-1).content, /안경을 고쳐 씀/);
  assert.match(plan.narration, /손등으로/);
});

test("askGM: 두 번 잇달아 캐릭터 말만 옮겨 쓰면 세 번째 응답을 씀", async () => {
  const { g } = table();
  const echo = JSON.stringify({ narration: "어두운 예배당 안에서 한진우에게 어두워서 무언가를 하기 어렵다고 말을 건넸다." });
  const replies = [echo, echo, JSON.stringify({ narration: "한진우가 성냥갑을 흔들어 보았다. \"세 개비 남았어요. 아껴 써야겠는데요.\"" })];
  let n = 0;
  g.aiCall = async () => replies[n++];
  const info = { skills: [], clues: [], checks: [], exits: [], pending: [], pendingOwners: [], chars: [{ pid: "p1", name: "김나윤", player: "가", items: [] }], npcs: [], actors: [], askers: [], order: ["p1"], askOnly: false,
    handouts: [], npcNames: ["한진우"], gotThisTurn: [], onlyFailedRolls: false, recentText: "", secrets: [], known: "", tone: "prose", askNpc: ["한진우"] };
  const plan = await g.askGM({ ctx: {}, info, recent: [] });
  assert.equal(n, 3);
  assert.match(plan.narration, /세 개비/);
});

test("직전 AI 서술이 다음 차례의 직전NPC대사 · 최근NPC대사 · 몸짓에 들어감", async () => {
  let reply = "";
  const t = aiTable(async () => reply);
  t.seat("c1", KEY, "가", "한서");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  t.g.onMessage("c1", { t: "chat", text: "@바르톨 그날 밤에 누굴 봤습니까?", style: "talk" }); t.stop();
  reply = JSON.stringify({ narration: '바르톨이 한숨을 쉼. "그날 밤엔 아무도 못 봤소, 정말이오."' });
  await t.g.runAI();
  t.g.onMessage("c1", { t: "chat", text: "@바르톨 정말입니까?", style: "talk" }); t.stop();
  const { info, ctx } = t.g.turnContext();
  assert.equal(JSON.stringify(info.prevQuotes), JSON.stringify(['"그날 밤엔 아무도 못 봤소, 정말이오."']));
  assert.match(info.prevNarration, /한숨/);
  assert.equal(JSON.stringify(info.npcRecent.바르톨), JSON.stringify(['"그날 밤엔 아무도 못 봤소, 정말이오."']));
  assert.equal(JSON.stringify(info.npcGestures.바르톨), JSON.stringify([["한숨"]]));
  assert.equal(JSON.stringify(info.npcRecentBy.바르톨.map((x) => x.by)), JSON.stringify([["한서"]]), "이번 차례 물음은 지난 대사의 질문자에 안 섞임");
  assert.ok(ctx.직전NPC대사 && ctx.최근NPC대사 && ctx.최근NPC몸짓);
  // 같은 대사를 되풀이하면 다시 요청
  reply = JSON.stringify({ narration: '바르톨이 그물을 내려놓음. "그날 밤엔 아무도 못 봤소, 정말이오."' });
  const calls = []; t.g.aiCall = async (m) => { calls.push(m.length); return reply; };
  await t.g.runAI();
  assert.ok(calls.length > 1, "직전 대사 되풀이 → 재요청");
});

test("되돌리기 · 진행 전환 뒤엔 밀어붙이기 대기 타이머가 AI를 다시 돌리지 않음", async () => {
  let n = 0;
  const t = aiTable(async (msgs) => { if (/게임 마스터/.test(msgs[0].content)) n++; return JSON.stringify({ narration: "바람이 붊." }); });
  t.seat("c1", KEY, "가", "한서");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  t.data.game.retries = { x: { pid: "x", at: Date.now(), spec: {} } }; t.data.game.retryFrom = Date.now();
  t.g.conns.set("x", "cx");
  await t.g.runAI();
  assert.ok(t.g.ai.hold, "결정 대기 중");
  t.g.invalidateAI();
  assert.equal(t.g.ai.hold, null);
  t.data.mode = "human";
  await t.g.runAI();
  assert.equal(n, 0, "사람 GM 모드에선 AI를 부르지 않음");
});

test("장면을 옮기는 차례에도 피해가 적용됨", () => {
  const t = aiTable(async () => "{}");
  const pid = t.seat("c1", KEY, "가", "한서");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  const c = t.data.players[pid].character, hp = c.hp;
  const s = t.m.Engine.sceneOf(t.sc, t.data.game);
  const exit = (s.exits ?? [])[0]; exit.when = "always";
  t.g.applyPlan({ narration: "한서가 돌에 맞은 채 달아남.", arrival: "새 장소에 도착함.", move: exit.to, answers: [], give: [], take: [], heal: [], blocks: [], newNpcs: [], showHandouts: [],
    hurt: [{ kind: "char", pid, id: null, name: c.name, dice: "1", db: "0", by: "돌" }] });
  assert.equal(t.data.game.currentScene, exit.to);
  assert.equal(c.hp, hp - 1);
});

test("직전NPC대사: 여러 명 결과 블록으로 나뉜 직전 차례의 대사를 모두 봄", async () => {
  let reply = "";
  const t = aiTable(async () => reply);
  t.seat("c1", KEY, "가", "한서"); t.seat("c2", KEY2, "나", "도윤");
  t.g.hostAction({ t: "start" }); t.g.invalidateAI();
  t.g.onMessage("c1", { t: "chat", text: "@바르톨 그날 밤에 누굴 봤습니까?", style: "talk" });
  t.g.onMessage("c2", { t: "chat", text: "선반을 뒤진다", style: "act" }); t.stop();
  reply = JSON.stringify({ narration: "", results: [{ who: "한서", text: '바르톨이 고개를 저음. "그날 밤엔 아무도 못 봤소."' }, { who: "도윤", text: "먼지 쌓인 장부가 드러남." }] });
  await t.g.runAI();
  const { info } = t.g.turnContext();
  assert.equal(JSON.stringify(info.prevQuotes), JSON.stringify(['"그날 밤엔 아무도 못 봤소."']));
  assert.match(info.prevNarration, /^바르톨이 고개를 저음/);
});
