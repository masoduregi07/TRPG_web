import test from "node:test";
import assert from "node:assert/strict";
import { load, sample } from "./load.mjs";

const j = (x) => JSON.parse(JSON.stringify(x));   // vm 쪽 배열과 비교
const KEY = "abcdefghijklmnop", KEY2 = "qrstuvwxyz012345";
function table(edit) {
  const m = load();
  const sc = sample(m); edit?.(sc); m.Engine.validateScenario(sc);
  const sent = [];
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "hosthosthosthost", hostPlays: false, mode: "human", scenario: sc });
  const g = new m.HostGame(data, { transport: { send: (c, msg) => sent.push([c, msg]), close: () => {} }, onLocal: () => {} });
  return { m, g, data, sent, sc };
}
function join(g, m, c, key, name, charName) {
  const r = g.onConnect(c, { key, name, build: m.APP_BUILD });
  g.onMessage(c, { t: "rollChars" });
  g.onMessage(c, { t: "char", character: { name: charName, background: "떠돌이 선원" }, ready: true });
  return r.pid;
}

test("캐릭터 이름이 다른 캐릭터 · NPC와 같으면 거부", () => {
  const { m, g, data } = table();
  const a = join(g, m, "c1", KEY, "가", "민준");
  const b = join(g, m, "c2", KEY2, "나", "민 준");
  assert.equal(data.players[a].character.name, "민준");
  assert.equal(data.players[b].character, null);
  g.onMessage("c2", { t: "char", character: { name: "바르톨" } });
  assert.equal(data.players[b].character, null);
  g.onMessage("c2", { t: "char", character: { name: "서연" } });
  assert.equal(data.players[b].character.name, "서연");
  g.onMessage("c1", { t: "char", character: { name: "민준" } });   // 내 이름 다시 저장은 허용
  assert.equal(data.players[a].character.name, "민준");
});

test("플레이어 사본 복구: 통과 판정 · 핸드아웃 · NPC 체력 · 요약 유지", () => {
  const { m, g, data, sc } = table((s) => { s.scenes.harbor.exits = [{ to: "lighthouse_door", when: "check(persuade_fisherman)" }]; });
  const pid = join(g, m, "c1", KEY, "가", "민준");
  g.hostAction({ t: "start" });
  Object.assign(data.game, { passedChecks: ["persuade_fisherman"], triedChecks: ["persuade_fisherman"], npcHp: { smuggler: 5 },
    handouts: { mira_note: { pids: [pid], npcs: [], clue: "daughter", scene: "harbor", at: 1 }, harbor_plan: { pids: [data.hostPid], npcs: [], clue: "rumor", scene: "harbor", at: 2 } },
    summaries: [{ scene: "harbor", title: "항구", text: "요약" }] });
  const snap = g.snapshotFor(pid);
  assert.deepEqual(j(Object.keys(snap.recovery.handouts)), ["mira_note"]);   // 내가 못 본 핸드아웃은 안 넣음
  const rec = m.HostGame.fromPlayerCopy({ kind: "trpg-player-copy", v: 1, snap, log: [] }, sc, "z".repeat(24));
  assert.deepEqual(j(m.Engine.availableExits(sc, rec.game).map((e) => e.to)), ["lighthouse_door"]);
  assert.deepEqual(j(rec.game.passedChecks), ["persuade_fisherman"]);
  assert.equal(rec.game.npcHp.smuggler, 5);
  assert.deepEqual(j(rec.game.handouts.mira_note.pids), [pid]);
  assert.equal(rec.game.summaries[0].text, "요약");
});

test("조건식에 한글 id", () => {
  const { m } = table();
  const sc = sample(m);
  sc.scenes.harbor.clues.push({ id: "편지", text: "편지 단서." });
  sc.scenes.harbor.exits.push({ to: "stairs", when: "clue(편지)" });
  assert.deepEqual(j(m.Engine.validateScenario(sc).errors), []);
  assert.equal(m.Engine.condOk("clue(편지)", { flags: {}, revealedClues: [{ id: "편지" }] }), true);
});

test("fail의 reveal · setFlag는 경고", () => {
  const { m } = table();
  const sc = sample(m);
  sc.scenes.stairs.checks[0].fail = { text: "x", reveal: "scratches" };
  const w = m.Engine.validateScenario(sc).warnings;
  assert.ok(w.some((x) => /fail의 reveal/.test(x)));
});

test("탐사자 → 이름 + 받침 조사", () => {
  const { m } = table();
  const t = m.Engine.nameExplorers("탐사자들은 문을 엶. 탐사자가 봄. 탐사자를 부름. 탐사자들에게 말함. 탐사자 기록지.", ["민준"]);
  assert.equal(t, "민준은 문을 엶. 민준이 봄. 민준을 부름. 민준에게 말함. 탐사자 기록지.");
  assert.equal(m.Engine.nameExplorers("탐사자들은 감.", ["서아"]), "서아는 감.");
});

test("실패한 사람에게 가는 물건만 무시", () => {
  const { m } = table();
  const info = { skills: [], clues: [], checks: [], exits: [], pending: [], chars: [{ pid: "a", name: "가", items: [] }, { pid: "b", name: "나", items: [] }],
    actors: [], askers: [], askOnly: false, handouts: [], npcNames: [], gotThisTurn: [], onlyFailedRolls: false, failedPids: ["a"], recentText: "", secrets: [], known: "" };
  const parsed = m.AI.parseGM(JSON.stringify({ narration: "가와 나가 움직임.", give_item: [{ to: "가", item: "열쇠" }, { to: "나", item: "등불" }] }));
  const { plan } = m.Turn.validate(parsed, info, { final: true });
  assert.deepEqual(j(plan.give.map((x) => x.item)), ["등불"]);
});

test("되돌리기는 AI가 추가한 NPC도 되돌림", () => {
  const { m, g, sc } = table();
  const cp = g.checkpoint();
  m.Engine.registerNpc(sc, "harbor", { name: "새인물", look: "키 큰 남자" });
  assert.ok(Object.values(sc.npcs).some((n) => n.name === "새인물"));
  g.restore(cp);
  assert.ok(!Object.values(g.sc.npcs).some((n) => n.name === "새인물"));
  assert.ok(!g.sc.scenes.harbor.npcs.some((id) => !g.sc.npcs[id]));
});

test("이성 판정 기록에 손실 · 단계 필드", () => {
  const { m, g, data } = table();
  const pid = join(g, m, "c1", KEY, "가", "민준");
  g.hostAction({ t: "start" });
  g.resolveCheck(pid, { label: "유령", san: "1/1d4" }, null, false);
  const e = data.log.find((x) => x.kind === "roll" && x.san);
  assert.ok(Number.isInteger(e.sanLoss) && e.sanLoss >= 1);
  assert.equal(typeof e.level, "string");
});
