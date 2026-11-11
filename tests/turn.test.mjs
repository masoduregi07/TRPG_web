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

// ---- 진행 검증: 판정 전 단서 · 반복 · 문체 · 선언 없는 이동 · 결과 되풀이 ----
const turn = (over = {}) => base({ secrets: [], checkReveals: [{ check: "k1", clue: "c1" }], ...over });

test("판정으로 공개될 단서는 그 판정을 거는 응답에서 공개 안 함", () => {
  const r = run({ narration: "한서가 벽 쪽으로 다가감.", reveal_clue: "c1", request_check: { id: "k1", who: "한서" } }, turn());
  assert.equal(r.plan.clue, null);
  assert.equal(r.plan.check?.id, "k1");
});

test("그 판정을 기다리는 중에도 공개 안 함, 판정과 무관한 공개는 허용", () => {
  assert.equal(run({ narration: "한서가 벽을 더듬음.", reveal_clue: "c1" }, turn({ pending: ["k1"] })).plan.clue, null);
  assert.equal(run({ narration: "한서가 벽을 더듬음.", reveal_clue: "c1" }, turn({ checkReveals: [] })).plan.clue, "c1");
});

test("한 명 행동이면 ▶ 블록 없이, 행동을 되풀이한 narration은 버림", () => {
  const r = run({ narration: "한서가 벽면 자국으로 다가감.", results: [{ who: "한서", text: "한서가 자국을 가까이서 살핌." }] }, turn({ checkReveals: [] }));
  assert.equal(r.plan.blocks.length, 0);
  assert.equal(r.plan.narration, "한서가 자국을 가까이서 살핌.");
});

test("여러 명 행동표면 블록 유지, 분위기 narration은 남김", () => {
  const chars = [{ pid: "p1", name: "한서", player: "가", items: [] }, { pid: "p2", name: "도윤", player: "나", items: [] }];
  const info = turn({ chars, actors: chars.map(({ pid, name }) => ({ pid, name })), table: true, checkReveals: [] });
  const r = run({ narration: "바람이 거세짐.", results: [{ who: "한서", text: "한서가 문을 엶." }, { who: "도윤", text: "도윤이 등불을 듦." }] }, info);
  assert.equal(r.plan.blocks.length, 3);
  assert.equal(r.plan.blocks[0].text, "바람이 거세짐.");
});

test("문체: 명사형인데 ~다로 끝나면 다시 요청, 따옴표 속 대사는 예외", () => {
  assert.ok(run({ narration: "한서가 자국으로 다가간다." }, turn({ checkReveals: [] })).issues.some((i) => i.hard && /문체/.test(i.msg)));
  assert.ok(!run({ narration: "어부가 고개를 듦. \"그건 모르겠소.\" 파도가 침." }, turn({ checkReveals: [] })).issues.some((i) => /문체/.test(i.msg)));
  assert.ok(run({ narration: "철문이 나타남. 바람이 새어 나옴." }, turn({ checkReveals: [], tone: "prose" })).issues.some((i) => i.hard && /문체/.test(i.msg)));
  const last = run({ narration: "한서가 다가간다." }, turn({ checkReveals: [] }), true);
  assert.ok(!last.issues.some((i) => i.hard) && last.plan.narration === "한서가 다가간다.", "마지막 시도는 그대로 둠");
});

test("판정 결과만 있는 차례: 이동 무시", () => {
  const r = run({ narration: "바르톨이 그물로 시선을 돌림.", move_to: "next", arrival: "철문이 나타남." }, turn({ checkReveals: [], rollOnly: true, actors: [] }));
  assert.equal(r.plan.move, null);
  assert.equal(r.plan.arrival, null);
});

test("판정 결과만 있는 차례: 받은 물건을 다시 서술하면 다시 요청, 마지막엔 그 문장 삭제 (비면 조용히 넘어감)", () => {
  const info = turn({ checkReveals: [], rollOnly: true, actors: [], gotThisTurn: ["녹슨 열쇠"], rollTexts: ["보통 성공 – 어부가 한숨을 쉬더니 녹슨 열쇠를 내밂."] });
  const obj = { narration: "한서가 녹슨 열쇠를 받아 듦. 바르톨이 그물로 시선을 돌림." };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /직전판정/.test(i.msg)));
  const last = run(obj, info, true);
  assert.equal(last.plan.narration, "바르톨이 그물로 시선을 돌림.");
  const only = run({ narration: "한서가 녹슨 열쇠를 받아 듦." }, info, true);
  assert.equal(only.plan.narration, "");
  assert.equal(only.plan.quiet, true);
  assert.ok(!only.issues.some((i) => i.hard));
});

test("결과 블록은 입력이 들어온 순서대로", () => {
  const chars = [{ pid: "p1", name: "한서", player: "가", items: [] }, { pid: "p2", name: "도윤", player: "나", items: [] }];
  const info = base({ secrets: [], chars, actors: chars.map(({ pid, name }) => ({ pid, name })), table: true, order: ["p2", "p1"] });
  const r = run({ narration: "", results: [{ who: "한서", text: "한서가 문을 엶." }, { who: "도윤", text: "도윤이 등불을 듦." }] }, info);
  assert.equal(r.plan.blocks.map((b) => b.name).join(","), "도윤,한서");
});

test("판정 결과만 있는 차례: 장소 변경(new_place · left_place)도 금지, 첫 시도는 다시 요청", () => {
  const info = turn({ checkReveals: [], rollOnly: true, actors: [] });
  const obj = { narration: "바르톨이 열쇠를 쥔 손을 내려다봄.", new_place: { name: "철문 앞" } };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /new_place/.test(i.msg)));
  const last = run(obj, info, true);
  assert.equal(last.plan.place, null);
  assert.equal(run({ narration: "바르톨이 고개를 끄덕임.", left_place: true }, info, true).plan.leavePlace, false);
  assert.equal(run(obj, turn({ checkReveals: [], rollOnly: false, actors: [] }), true).plan.place?.name, "철문 앞");
});

test("단서 공개: 서술에 내용이 없으면 다시 요청, 마지막엔 공개 보류", () => {
  const clue = "마을 사람들은 밤마다 등대 꼭대기에서 여자의 노랫소리가 들린다며 수군거림.";
  const info = base({ secrets: [{ kind: "미공개 단서", clue: "c1", text: clue }] });
  const off = { narration: '바르톨은 콧방귀를 뀜. "할 일도 없는 양반이구만. 등대 소문이라도 들으러 온 거요?"', reveal_clue: "c1" };
  const a = run(off, info);
  assert.ok(a.issues.some((i) => i.hard && /c1/.test(i.msg)));
  assert.ok(!a.issues.some((i) => i.msg.includes("노랫소리")), "경고문에 단서 원문을 넣지 않음");
  const b = run(off, info, true);
  assert.equal(b.plan.clue, null);
  const ok = run({ narration: '바르톨이 목소리를 낮춤. "마을 사람들 말로는 밤이면 등대 위에서 여자가 노래한다더군."', reveal_clue: "c1" }, info);
  assert.equal(ok.plan.clue, "c1");
  assert.ok(!ok.issues.some((i) => i.hard));
});

test("gmSystem: NPC가 묻지 않은 단서를 먼저 꺼내지 않음 규칙 포함", () => {
  assert.match(AI.gmSystem(), /먼저 꺼내거나/);
});

test("KPC 자리표시자: 새 인물을 kpc 표시 없이 올리면 한 번 다시 묻고, 마지막엔 그대로", () => {
  const obj = { narration: "아치 앞에 동료 한진우가 서 있음.", new_npcs: [{ name: "한진우", job: "수도원 관계자", look: "코트 차림", personality: "차분함" }] };
  const info = base({ kpcOpen: true });
  assert.ok(run(obj, info).issues.some((i) => i.hard && /KPC/.test(i.msg)));
  assert.ok(!run(obj, info, true).issues.some((i) => i.hard));
  const ok = { ...obj, new_npcs: [{ ...obj.new_npcs[0], id: "kpc" }] };
  assert.ok(!run(ok, info).issues.some((i) => i.hard), "id kpc로 보내면 통과");
  assert.ok(!run(obj, base()).issues.some((i) => i.hard && /KPC/.test(i.msg)), "자리표시자가 없으면 검사 안 함");
});

test("입력 없는 캐릭터를 주어로 행동을 정하면 다시 묻고, 마지막엔 그 문장만 삭제", () => {
  const info = base({ actors: [], order: [], chars: [{ pid: "p1", name: "신서현", player: "가", items: [] }] });
  const obj = { narration: "안개가 짙어짐. 신서현은 주머니 속 칼을 점검함. 한진우가 다가와 입을 엶. \"서현 씨, 들어가 보죠.\"" };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /신서현/.test(i.msg)));
  const b = run(obj, info, true);
  assert.ok(!b.issues.some((i) => i.hard));
  assert.equal(b.plan.narration, "안개가 짙어짐. 한진우가 다가와 입을 엶. \"서현 씨, 들어가 보죠.\"");
  assert.ok(run({ narration: "서현은 숨을 고름." }, info).issues.some((i) => i.hard), "이름만(성 뺀)도 잡음");
  assert.ok(!run({ narration: "한진우가 신서현을 바라봄." }, info).issues.some((i) => i.hard), "다른 인물이 주어면 통과");
  const acted = base({ chars: [{ pid: "p1", name: "신서현", player: "가", items: [] }], actors: [{ pid: "p1", name: "신서현" }], order: ["p1"] });
  assert.ok(!run({ narration: "신서현은 문을 밂. 문이 열림." }, acted).issues.some((i) => i.hard), "입력한 캐릭터는 주어로 써도 됨");
});

test("NPC가 직전 대사를 거의 그대로 되풀이하면 다시 물음", () => {
  const info = base({ prevQuotes: ["\"서현 씨, 날씨가 이래서 찬바람이 거세군요. 조심해서 안으로 들어가 보죠.\""] });
  assert.ok(run({ narration: "한서를 보며 말함. \"날씨가 이래서 찬바람이 거세군요. 조심해서 안으로 들어가 보죠.\"" }, info).issues.some((i) => i.hard && /되풀이/.test(i.msg)));
  assert.ok(!run({ narration: "한진우가 웃음. \"안녕하세요. 오늘따라 목소리가 밝네요.\"" }, info).issues.some((i) => i.hard));
  assert.ok(!run({ narration: "한서를 보며 말함. \"날씨가 이래서 찬바람이 거세군요. 조심해서 안으로 들어가 보죠.\"" }, info, true).issues.some((i) => i.hard), "마지막 시도는 통과");
});

test("캐릭터가 NPC에게 한 말을 주어 없이 되풀이하면 다시 묻고, 마지막엔 그 문장만 삭제", () => {
  const info = base({ chars: [{ pid: "p1", name: "신서현", player: "가", items: [] }], actors: [], order: ["p1"], npcNames: ["한진우"] });
  const obj = { narration: "한진우는 사방을 둘러보며 낮게 말함. \"일단 제단 쪽을 더듬어보죠.\" 한진우에게 앞으로의 대처를 물음." };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /되풀이/.test(i.msg)));
  assert.equal(run(obj, info, true).plan.narration, "한진우는 사방을 둘러보며 낮게 말함. \"일단 제단 쪽을 더듬어보죠.\"");
  assert.ok(!run({ narration: "한진우에게서 낡은 성냥 냄새가 남." }, info).issues.some((i) => i.hard), "에게서는 통과");
});
