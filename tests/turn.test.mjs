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

test("받은 물건이 서술에 없으면 다시 묻고, 마지막엔 주지 않음", () => {
  const info = base();
  const obj = { narration: "한서가 어두운 제단 쪽을 더듬어 살핌.", give_item: [{ to: "한서", item: "오래된 쪽지" }] };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /오래된 쪽지/.test(i.msg)));
  assert.equal(run(obj, info, true).plan.give.length, 0);
  const ok = { narration: "한서가 제단 옆에서 양피지 쪽지를 집어 듦.", give_item: [{ to: "한서", item: "오래된 쪽지" }] };
  assert.equal(run(ok, info).plan.give.length, 1, "끝 낱말(쪽지)이 서술에 있으면 통과");
});

test("NPC가 회피형 대답을 세 번 잇달아 하면 다시 물음", () => {
  const info = base({ npcNames: ["한진우"], npcRecent: { 한진우: ["\"무슨 소리인지 잘 모르겠군요.\"", "\"저도 당황스럽군요.\""] } });
  assert.ok(run({ narration: "한진우는 고개를 저음. \"저도 모르겠습니다.\"" }, info).issues.some((i) => i.hard && /규칙 28 · 31\)/.test(i.msg)));
  assert.ok(!run({ narration: "한진우는 쪽지를 뒤집어 봄. \"이 필체, 예전 기록실 담당자 것 같아요.\"" }, info).issues.some((i) => i.hard));
  assert.ok(!run({ narration: "한진우는 고개를 저음. \"저도 모르겠습니다.\"" }, base({ npcNames: ["한진우"], npcRecent: { 한진우: ["\"저도 당황스럽군요.\""] } })).issues.some((i) => i.hard), "두 번째까지는 통과");
  // "짐작뿐 · 더 조사해 보자"로 미루는 대답도 회피로 셈
  const put = base({ npcNames: ["한시준"], npcRecent: { 한시준: ["\"글쎄요, 예배당 안을 좀 더 둘러보면 단서가 나올지도요.\"", "\"저도 짐작뿐입니다만 무언가 있겠죠.\""] } });
  assert.ok(run({ narration: "한시준은 안경을 추켜올림. \"저기 천장이나 벽 쪽을 조사해보는 게 순서 아닐까요? 당장 알 도리는 없습니다.\"" }, put).issues.some((i) => i.hard && /미루는/.test(i.msg)));
  assert.ok(!run({ narration: "한시준은 숨을 고름. \"아마… 마을에 돌던 이단 이야기 아닐까요. 어릴 때 들은 적이 있어요.\"" }, put).issues.some((i) => i.hard), "짐작을 말하면 통과");
});

test("npcLines: 대사 앞의 가장 가까운 NPC 이름이 주인", () => {
  const r = Turn.npcLines("바르톨이 웃음. \"어서 와.\" 한진우는 고개를 끄덕임. \"들어가죠.\"", ["바르톨", "한진우"]);
  assert.equal(JSON.stringify(r.map((x) => x.who)), JSON.stringify(["바르톨", "한진우"]));
});

test("플레이어 입력을 되풀이만 한 서술이면 다시 물음", () => {
  const info = base({ chars: [{ pid: "p1", name: "박지우", player: "가", items: [] }], actors: [{ pid: "p1", name: "박지우" }], order: ["p1"], inputs: ["따라가지 않고 버틴다"] });
  assert.ok(run({ narration: "따라가지 않고 아치형 입구 앞에서 버틴다." }, info).issues.some((i) => i.hard && /되풀이만/.test(i.msg)));
  assert.ok(run({ narration: "음... 아무도 신경 안쓰나" }, base({ ...info, inputs: ["음... 아무도 신경 안쓰나"] })).issues.some((i) => i.hard && /되풀이만/.test(i.msg)));
  assert.ok(!run({ narration: "박지우가 버티자 한은우가 멈춰 섬. \"같이 가요, 혼자 두긴 싫어요.\" 바람에 덩굴이 흔들림." }, info).issues.some((i) => i.hard && /되풀이만/.test(i.msg)), "결과가 덧붙으면 통과");
  assert.ok(!run({ narration: "따라가지 않고 버팀." }, info, true).issues.some((i) => i.hard), "마지막은 통과");
});

test("판정과 맞는 행동인데 판정 없이 서술하면 다시 물음", () => {
  const info = base({ actTexts: ["계단 벽의 글씨를 살펴봄"], sceneTitle: "1층과 2층 사이 — 낡은 계단",
    openChecks: [{ id: "stair_listen", label: "계단의 이중 소리 듣기" }, { id: "stair_graffiti_spot", label: "벽글씨 원문 살피기" }] });
  const a = run({ narration: "벽의 비뚤어진 글씨를 유심히 살핌." }, info);
  assert.ok(a.issues.some((i) => i.hard && /stair_graffiti_spot/.test(i.msg) && !/stair_listen/.test(i.msg)), "사건 제목 낱말(계단)만 겹친 판정은 빼고");
  assert.ok(!run({ narration: "벽 쪽으로 다가감.", request_check: { id: "k1", who: "한서" } }, base({ ...info, checks: ["k1"] })).issues.some((i) => i.hard && /가능한판정/.test(i.msg)), "판정을 걸면 통과");
  assert.ok(!run({ narration: "계단을 천천히 오름." }, base({ ...info, actTexts: ["계단을 오른다"] })).issues.some((i) => i.hard && /가능한판정/.test(i.msg)));
  // 공개조건을 채운(판정 보상이 아닌) 단서를 공개하면 통과, 판정 보상 단서면 그대로 다시 물음
  const free = base({ ...info, clues: ["wall_text"], checkReveals: [{ check: "stair_graffiti_spot", clue: "graffiti_note" }] });
  assert.ok(!run({ narration: "벽의 글씨를 살피니 '물러가라'는 글귀가 보임.", reveal_clue: "wall_text" }, free).issues.some((i) => i.hard && /가능한판정/.test(i.msg)), "판정 보상 아닌 단서");
  const gated = base({ ...info, clues: ["graffiti_note"], checkReveals: [{ check: "stair_graffiti_spot", clue: "graffiti_note" }] });
  assert.ok(run({ narration: "벽의 글씨를 살핌.", reveal_clue: "graffiti_note" }, gated).issues.some((i) => i.hard && /가능한판정/.test(i.msg)), "판정 보상 단서");
});

test("npc_card: 이 사건 NPC만 받음", () => {
  const info = base({ npcIds: [{ id: "fisherman", name: "바르톨" }], npcNames: ["바르톨"] });
  const r = run({ narration: "바르톨이 고개를 끄덕임.", npc_card: [{ who: "바르톨", knows: ["열쇠 이야기를 들음"] }, { who: "없는사람", wants: "x" }] }, info);
  assert.equal(r.plan.npcCards.length, 1);
  assert.equal(r.plan.npcCards[0].id, "fisherman");
});

test("kpc_away: 이름이 정해진 KPC가 있을 때만 받음", () => {
  assert.equal(run({ narration: "한은우가 어둠 속으로 끌려감.", kpc_away: true }, base({ kpcName: "한은우" })).plan.kpcAway, true);
  assert.equal(run({ narration: "바람이 붊.", kpc_away: true }, base()).plan.kpcAway, null);
});

test("판정 여러 개: 캐릭터마다 하나씩, 같은 캐릭터 두 번째는 버림", () => {
  const two = base({ checks: ["k1", "k2"], chars: [{ pid: "p1", name: "한서", items: [] }, { pid: "p2", name: "민준", items: [] }], actors: [{ pid: "p1", name: "한서" }, { pid: "p2", name: "민준" }] });
  const r = run({ narration: "한서와 민준이 각자 움직임.", request_check: [{ id: "k1", who: "한서" }, { id: "k2", who: "민준" }], improv_check: { skill: "관찰력", reason: "더 봄", who: "한서" } }, two, true);
  assert.equal(JSON.stringify(r.plan.checks.map((c) => [c.type, c.whoName])), JSON.stringify([["scene", "한서"], ["scene", "민준"]]));
  assert.equal(r.plan.check.id, "k1");
  const one = run({ narration: "한서가 살핌.", request_check: { id: "k1", who: "한서" } });
  assert.equal(one.plan.checks.length, 1);
});

test("회피 세 번째: 같은 NPC + 같은 질문자만 셈", () => {
  const recent = { 한진우: [{ q: "\"저도 모르겠습니다.\"", by: ["민준"] }, { q: "\"글쎄요.\"", by: ["서연"] }] };
  const say = { narration: "한진우는 고개를 저음. \"그건 알 수 없소.\"" };
  assert.ok(!run(say, base({ npcNames: ["한진우"], npcRecentBy: recent, talkTo: { 한진우: ["한서"] } })).issues.some((i) => i.hard && /세 번째/.test(i.msg)), "다른 사람들에게 한 거절은 안 셈");
  const same = { 한진우: [{ q: "\"저도 모르겠습니다.\"", by: ["한서"] }, { q: "\"글쎄요.\"", by: ["한서"] }] };
  assert.ok(run(say, base({ npcNames: ["한진우"], npcRecentBy: same, talkTo: { 한진우: ["한서"] } })).issues.some((i) => i.hard && /세 번째/.test(i.msg)), "같은 사람에게 세 번째");
});

test("겹친 문장: narration + 한 명 results를 이을 때 같은 문장은 하나만", () => {
  const s = "바르톨이 콧방귀를 뀌며 그물에 다시 시선을 고정함.";
  const a = run({ narration: s, results: [{ who: "한서", text: s }] }, base({ npcNames: ["바르톨"] }));
  assert.equal(a.plan.narration, s);
  const b = run({ narration: `${s} 파도가 침. ${s}` });
  assert.equal(b.plan.narration, `${s} 파도가 침.`);
  assert.equal(Turn.dedupSentences("짧음. 짧음."), "짧음. 짧음.", "4자 미만 짧은 문장은 그대로");
  // 대사 끝 토막이 따옴표 밖에 한 번 더 붙은 응답 (5자 문장 + 짝 없는 따옴표)
  assert.equal(Turn.dedupSentences('한진우는 멋쩍게 웃었다. "아, 제 주머니요! 자, 보실래요?" 자, 보실래요?"'), '한진우는 멋쩍게 웃었다. "아, 제 주머니요! 자, 보실래요?"');
  assert.equal(Turn.dedupSentences('한진우가 말했다. "자, 보실래요? 자, 보실래요?"'), '한진우가 말했다. "자, 보실래요?"', "닫는 따옴표는 남김");
});

test("NPC에게 물었는데 대사 없이 몸짓만: 첫 시도 다시 요청, 대사가 있으면 통과", () => {
  const info = base({ npcNames: ["바르톨"], askNpc: ["바르톨"] });
  const mute = run({ narration: "바르톨이 콧방귀를 뀌며 그물에 시선을 고정함." }, info);
  assert.ok(mute.issues.some((i) => i.hard && /대사로 대답하지 않음/.test(i.msg)));
  assert.ok(!run({ narration: "바르톨이 콧방귀를 뀜. \"내 알 바 아니라니까. 등대 일은 묻지 마쇼.\"" }, info).issues.some((i) => /대사로 대답하지 않음/.test(i.msg)));
  assert.ok(!run({ narration: "바르톨이 콧방귀를 뀜." }, info, true).issues.some((i) => i.hard), "마지막 시도는 통과");
  assert.ok(Turn.isQuestion("아는 사람이 아닌거요?") && Turn.isQuestion("왜 알 바가 아니오.") && Turn.isQuestion("그 등대에 누가 사나"));
  assert.ok(!Turn.isQuestion("고맙소.") && !Turn.isQuestion("그물을 살핀다"));
});

test("문체: 명사로 끝난 문장(바다 · 고요 · 필요)은 어긋난 것으로 안 셈, 서술형 어미는 셈", () => {
  const m = load();
  for (const t of ["창밖에는 검은 바다. 파도 소리만 들림.", "등대 안은 고요. 물 떨어지는 소리가 남.", "열쇠가 필요. 문은 굳게 잠겨 있음."]) assert.equal(m.Turn.toneOff(t, "nominal").off, false, t);
  for (const t of ["문이 열렸다. 안은 어둡다.", "바람이 분다. 길이 멀다.", "누구일까. 여기 있어요."]) assert.equal(m.Turn.toneOff(t, "nominal").off, true, t);
});

test("판정 결과만 있는 차례: 받은 물건을 살피는 반응은 통과, 건넴을 다시 쓰면 재요청", () => {
  const m = load();
  const info = { chars: [{ pid: "a", name: "한서", player: "가", items: ["녹슨 열쇠"] }], actors: [], askers: [], skills: [], clues: [], checks: [], exits: [],
    rollOnly: true, gotThisTurn: ["녹슨 열쇠"], rollTexts: ["보통 성공 — 어부가 한숨을 쉬더니 녹슨 열쇠를 내밂."], recentText: "", order: ["a"] };
  const look = m.Turn.validate(m.AI.parseGM(JSON.stringify({ narration: "한서가 손바닥 위의 녹슨 열쇠를 뒤집어 봄. 손잡이에 등대 문양이 희미하게 남아 있음." })), info, {});
  assert.ok(!look.issues.some((x) => x.hard), JSON.stringify(look.issues));
  const again = m.Turn.validate(m.AI.parseGM(JSON.stringify({ narration: "바르톨이 녹슨 열쇠를 한서에게 건넴. 바람이 거세짐." })), info, {});
  assert.ok(again.issues.some((x) => x.hard && /이미 나온 일/.test(x.msg)));
});

// ---- 실제 플레이 기록(1층 예배당)에서 나온 문제 ----
const chapel = (over = {}) => base({ chars: [{ pid: "p1", name: "김나윤", player: "가", items: [] }], actors: [], order: ["p1"], npcNames: ["한진우"], ...over });

test("캐릭터가 NPC에게 한 말을 풀어 쓴 문장(…에게 …말을 건넸다)은 문장 앞에 다른 말이 붙어도 되풀이", () => {
  const info = chapel({ askNpc: ["한진우"] });
  const echo = { narration: "어두운 예배당 안에서 한진우에게 어두워서 무언가를 하기 어렵다고 말을 건넸다." };
  assert.ok(run(echo, info).issues.some((i) => i.hard && /규칙 10/.test(i.msg)));
  assert.ok(run({ narration: "김나윤은 한진우에게 어깨의 얼룩이 무엇인지 물었다. 한진우가 어깨를 털었다." }, info).issues.some((i) => i.hard && /규칙 10/.test(i.msg)), "캐릭터가 주어여도");
  assert.equal(run({ narration: "김나윤은 한진우에게 어깨의 얼룩이 무엇인지 물었다. 한진우가 어깨를 털었다. \"빗물이겠죠.\"" }, info, true).plan.narration, "한진우가 어깨를 털었다. \"빗물이겠죠.\"", "마지막 시도는 그 문장만 삭제");
  for (const ok of ["한진우는 김나윤에게 손전등이 없느냐고 물었다.", "관리인이 한진우에게 다가와 낮게 말했다. \"문 닫을 시간이오.\"", "김나윤이 묻자 한진우는 천장을 올려다보았다. \"위에서 떨어진 거네요.\"", "한진우에게서 쇠 냄새가 났다."])
    assert.ok(!run({ narration: ok }, chapel({ npcNames: ["한진우", "관리인"] })).issues.some((i) => /규칙 10/.test(i.msg)), ok);
});

test("NPC 몸짓: 주인 찾기 · 최근 서술에서 쓴 몸짓을 또 쓰면 다시 물음", () => {
  const g = (t) => JSON.parse(JSON.stringify(Turn.gestures(t, ["한진우"], ["김나윤"])));
  assert.deepEqual(g("한진우는 안경을 고쳐 쓰며 주위를 두리번거렸다. \"한숨이 나오네요.\""), { 한진우: ["안경을 고쳐 씀"] }, "따옴표 안은 안 셈");
  assert.deepEqual(g("김나윤이 한숨을 쉬었다."), {}, "캐릭터 몸짓은 안 셈");
  assert.deepEqual(g("진우는 멋쩍게 웃었다."), { 한진우: ["멋쩍은 웃음", "웃음"] }, "성 뺀 이름도");
  const info = chapel({ npcGestures: { 한진우: [["안경을 고쳐 씀"], ["멋쩍은 웃음", "웃음"]] } });
  const again = run({ narration: "한진우는 손가락을 닦아내며 안경을 다시 고쳐 썼다. \"왠지 쇠 냄새가 나네요.\"" }, info);
  assert.ok(again.issues.some((i) => i.hard && /안경을 고쳐 씀/.test(i.msg)));
  assert.ok(!run({ narration: "한진우는 손끝을 코에 가져갔다가 얼굴을 굳혔다. \"쇠 냄새… 이거 피 같은데요.\"" }, info).issues.some((i) => /몸짓/.test(i.msg)));
  assert.ok(!run({ narration: "한진우가 웃었다. \"별일 아니에요.\"" }, info).issues.some((i) => /몸짓/.test(i.msg)), "흔한 몸짓(웃음)은 두 번 이어 쓴 뒤에만");
  assert.ok(run({ narration: "한진우가 웃었다. \"별일 아니에요.\"" }, chapel({ npcGestures: { 한진우: [["웃음"], ["웃음"]] } })).issues.some((i) => i.hard && /웃음/.test(i.msg)));
  assert.ok(!again.issues.length || !run({ narration: "한진우는 안경을 다시 고쳐 썼다. \"쇠 냄새가 나네요.\"" }, info, true).issues.some((i) => i.hard), "마지막 시도는 통과");
});

test("서술이 직전 서술과 같은 말머리로 시작하면 다시 물음", () => {
  const info = chapel({ prevNarration: "어두운 예배당 안에서 한진우에게 말을 건넸다." });
  assert.ok(run({ narration: "어두운 예배당 안에서 한진우는 주위를 두리번거렸다. \"주머니를 뒤져 볼까요?\"" }, info).issues.some((i) => i.hard && /말머리/.test(i.msg)));
  assert.ok(!run({ narration: "한진우가 제복 주머니를 더듬었다. \"성냥이 더 있을 텐데.\"" }, info).issues.some((i) => /말머리/.test(i.msg)));
});

test("지시문: 사실 유지 · 말 뒤집기 · 몸짓 · 문답 맴돎 안내가 들어 있음", () => {
  const sys = AI.gmMessages({}, [], {})[0].content;
  for (const k of ["이미 정해진 것(색 · 냄새", "까닭 없이 뒤집지 않는다", "최근NPC몸짓", "문답만 이어짐"]) assert.ok(sys.includes(k), k);
  assert.deepEqual([...sys.matchAll(/^(\d+)\. /gm)].map((x) => +x[1]), Array.from({ length: 39 }, (_, i) => i + 1), "번호 1~39 그대로");
});

// ---- 실패한 판정의 성공 보상 잠금 (규칙 16) ----
const FR = { check: "persuade", label: "어부 설득하기", clue: "c1", item: "녹슨 열쇠", failedPids: ["p1"] };
test("실패 보상: 실패한 캐릭터에게 그 판정의 단서 · 같은 끝 낱말 물건을 주면 다시 요청, 마지막은 통과", () => {
  const info = base({ failedRewards: [FR], turnPids: ["p1"] });
  const a = run({ narration: "바르톨이 벽장 쪽을 가리킴. 판자 뒤에 오래된 항해 일지가 숨겨져 있음.", reveal_clue: "c1" }, info);
  assert.ok(a.issues.some((i) => i.hard && /규칙 16/.test(i.msg)));
  const b = run({ narration: "바르톨이 등대 열쇠를 바닥에 던짐. 한서가 열쇠를 주움.", give_item: { to: "한서", item: "등대 열쇠" } }, info);
  assert.ok(b.issues.some((i) => i.hard && /등대 열쇠/.test(i.msg) && /녹슨 열쇠/.test(i.msg)));
  const c = run({ narration: "바르톨이 등대 열쇠를 바닥에 던짐. 한서가 열쇠를 주움.", give_item: { to: "한서", item: "등대 열쇠" } }, info, true);
  assert.ok(!c.issues.some((i) => i.hard));
  assert.equal(c.plan.give.length, 1, "마지막 시도는 통과");
});
test("실패 보상: 멀티에서 실패하지 않은 캐릭터가 함께 행동했으면 단서는 그대로, 그 캐릭터가 받는 물건도 그대로", () => {
  const chars = [{ pid: "p1", name: "한서", player: "가", items: [] }, { pid: "p2", name: "민우", player: "나", items: [] }];
  const info = base({ chars, failedRewards: [FR], turnPids: ["p1", "p2"] });
  const a = run({ narration: "민우가 벽장을 뒤짐. 판자 뒤에 오래된 항해 일지가 숨겨져 있음. 바르톨이 민우에게 녹슨 열쇠를 건넴.", reveal_clue: "c1", give_item: { to: "민우", item: "녹슨 열쇠" } }, info);
  assert.ok(!a.issues.some((i) => /규칙 16/.test(i.msg)));
});

// ---- 핸드아웃이 붙은 단서 (규칙 17) ----
test("핸드아웃 단서: 실물이 서술에 없으면 다시 요청, 쪽지가 나오면 통과", () => {
  const info = base({ clueHandouts: { c1: { title: "미라의 쪽지", kind: "note" } } });
  const a = run({ narration: "판자 뒤에 오래된 항해 일지가 숨겨져 있음.", reveal_clue: "c1" }, info);
  assert.ok(a.issues.some((i) => i.hard && /미라의 쪽지/.test(i.msg)));
  const b = run({ narration: "판자 뒤에 오래된 항해 일지가 숨겨져 있음. 일지 사이에 접힌 쪽지 한 장이 끼워져 있음.", reveal_clue: "c1" }, info);
  assert.ok(!b.issues.some((i) => /핸드아웃/.test(i.msg)));
});

// ---- 한 서술 안 같은 몸짓 두 번 · 대사 뒤 간접 인용 요약 ----
test("같은 몸짓을 한 서술에서 두 번 쓰면 다시 요청", () => {
  const info = base({ npcNames: ["바르톨"] });
  const a = run({ narration: "바르톨이 콧방귀를 뀌며 그물을 당김. \"누가 가겠나.\" 바르톨이 다시 콧방귀를 뀌며 돌아섬." }, info);
  assert.ok(a.issues.some((i) => i.hard && /두 번/.test(i.msg)));
});
test("대사 바로 뒤에 '~다고 대답함'으로 같은 말을 요약하면 다시 요청", () => {
  const info = base({ npcNames: ["바르톨"] });
  const a = run({ narration: "바르톨이 낮게 읊조림. \"30년째 문이 잠겨 있는데 누가 가겠나.\" 바르톨이 문이 잠겨 있어 갈 수 없다고 대답함." }, info);
  assert.ok(a.issues.some((i) => i.hard && /다시 요약/.test(i.msg)));
  const b = run({ narration: "바르톨이 낮게 읊조림. \"30년째 문이 잠겨 있는데 누가 가겠나.\" 바람이 거세짐." }, info);
  assert.ok(!b.issues.some((i) => /다시 요약/.test(i.msg)));
});
test("판정 누락: 행동한 캐릭터가 이미 실패한 판정은 다시 걸라고 하지 않음", () => {
  const info = base({ actTexts: ["어부를 설득한다"], openChecks: [{ id: "k1", label: "어부 설득하기", failedPids: ["p1"] }] });
  const a = run({ narration: "바르톨은 대꾸 없이 그물만 손질함." }, info);
  assert.ok(!a.issues.some((i) => /가능한판정/.test(i.msg)));
  const b = run({ narration: "바르톨은 대꾸 없이 그물만 손질함." }, base({ actTexts: ["어부를 설득한다"], openChecks: [{ id: "k1", label: "어부 설득하기", failedPids: [] }] }));
  assert.ok(b.issues.some((i) => /가능한판정/.test(i.msg)));
});

test("이미 실패 · 성공한 판정을 같은 캐릭터에게 다시 걸지 않음 (규칙 16)", () => {
  const obj = { narration: "한서가 선반을 다시 살핌.", request_check: { id: "k1", who: "한서" } };
  const failed = base({ checkTries: [{ id: "k1", passed: false, failedPids: ["p1"] }] });
  const a = run(obj, failed);
  assert.ok(a.issues.some((i) => i.hard && /이미 실패/.test(i.msg)));
  assert.equal(a.plan.check, null);
  const b = run(obj, failed, true);
  assert.ok(!b.issues.some((i) => i.hard), "마지막은 판정만 빼고 통과");
  assert.equal(b.plan.checks.length, 0);
  // 실패하지 않은 다른 캐릭터에게는 그대로
  const two = base({ chars: [{ pid: "p1", name: "한서", player: "가", items: [] }, { pid: "p2", name: "민준", player: "나", items: [] }], checkTries: [{ id: "k1", passed: false, failedPids: ["p1"] }] });
  assert.equal(run({ narration: "민준이 선반을 살핌.", request_check: { id: "k1", who: "민준" } }, two).plan.check?.who, "p2");
  const passed = run(obj, base({ checkTries: [{ id: "k1", passed: true, failedPids: [] }] }));
  assert.equal(passed.plan.check, null, "이미 성공한 판정");
  assert.ok(!passed.issues.some((i) => i.hard));
});

test("전원 실패 단서 무시는 판정 결과만 있는 차례에만", () => {
  const obj = { narration: "한서가 벽장을 뒤짐. 판자 뒤에 오래된 항해 일지가 숨겨져 있음.", reveal_clue: "c1" };
  assert.equal(run(obj, base({ onlyFailedRolls: true, rollOnly: true })).plan.clue, null);
  assert.equal(run(obj, base({ onlyFailedRolls: true, rollOnly: false })).plan.clue, "c1", "같은 차례에 행동이 있으면 공개조건의 다른 길일 수 있음");
});

test("narration이 글이 아니어도 답변 · 결과가 있으면 읽음", () => {
  const p = AI.parseGM(JSON.stringify({ narration: ["x"], answers: [{ to: "한서", text: "문은 잠겨 있음." }] }));
  assert.equal(p.ok, true);
  assert.equal(p.res.narration, "");
});

test("지시문: 규칙끼리 어긋나지 않게 예외를 적음", () => {
  const sys = AI.gmSystem();
  assert.match(sys, /"실패한사람"이면 16번대로 다시 걸지 않고/);
  assert.match(sys, /34번의 소지품 바로잡기 give_item만 예외/);
  assert.match(sys, /19번 지금줄힌트 · 20번 정체시진행은 예외/);
  for (let n = 1; n <= 39; n++) assert.ok(sys.includes(`\n${n}. `), `규칙 ${n}번`);
});

test("@NPC 물음에 판정을 걸면 대사 없이 판정 직전까지만 서술해도 됨 (규칙 8 · 13)", () => {
  const info = base({ npcNames: ["바르톨"], askNpc: ["바르톨"], actors: [], turnPids: ["p1"] });
  const withCheck = run({ narration: "바르톨이 그물에서 눈을 떼지 않음.", request_check: { id: "k1", who: "한서" } }, info);
  assert.ok(!withCheck.issues.some((i) => i.hard), JSON.stringify(withCheck.issues));
  assert.ok(run({ narration: "바르톨이 그물에서 눈을 떼지 않음." }, info).issues.some((i) => i.hard && /대사로 대답하지 않음/.test(i.msg)));
});

test("성역 예배당 기록: 주어 없는 되풀이 · 재촉 반복 · 없는 이름 · 게임 밖 낱말", () => {
  const info = (over = {}) => base({ chars: [{ pid: "p1", name: "이예준", player: "가", items: [] }], actors: [], order: ["p1"], npcNames: ["로렌스"], tone: "prose",
    places: ["아치문", "제단", "십자가", "벽의 초상화 액자", "천장 아래"], inputs: ["아니 방금 로렌스씨 머리에 뭔가 떨어졌잖아요. 피라며요."], ...over });
  const hardOf = (obj, i, final = false) => run(obj, i, final).issues.filter((x) => x.hard).map((x) => x.msg).join("\n");
  // 주어 없이 캐릭터 말을 옮긴 문장
  const echo = { narration: '로렌스는 천장을 노려보았다. "진짜 피 같다니까요?" 로렌스의 머리에 떨어진 액체가 피라는 사실을 지적하며 불안감을 내비쳤다.' };
  assert.match(hardOf(echo, info()), /규칙 10/);
  assert.equal(run(echo, info(), true).plan.narration, '로렌스는 천장을 노려보았다. "진짜 피 같다니까요?"');
  assert.match(hardOf({ narration: '로렌스는 고개를 들었다. "피 맞아요." 로렌스의 머리에 떨어진 검붉은 액체의 정체에 대해 거듭 물었다.' }, info()), /규칙 10/);
  for (const ok of ['로렌스는 이예준의 소매를 붙잡았다. 그리고 낮게 물었다. "들었어요?"', "로렌스가 벽의 얼룩을 가리키며 불안감을 내비쳤다.", "이예준이 로렌스의 어깨를 짚으며 물었다."])
    assert.doesNotMatch(hardOf({ narration: ok }, info()), /규칙 10/, ok);
  // 같은 곳을 또 권함
  const past = { 로렌스: ['"이 제단 쪽이나 벽 쪽을 좀 더 둘러보죠, 네?"', '"얼른 다른 데를 보죠."'] };
  const nag = { narration: '로렌스는 발을 굴렀다. "얼른 제단 쪽이나 조사해 보자니까요."' };
  assert.match(hardOf(nag, info({ npcRecent: past })), /로렌스: 제단, 규칙 31/);
  assert.equal(hardOf(nag, info({ npcRecent: past }), true), "", "마지막 시도는 통과");
  assert.equal(hardOf(nag, info()), "", "처음 권하는 것은 통과");
  assert.equal(hardOf(nag, info({ npcRecent: past, inputs: ["제단에 뭐가 있다는 거예요?"] })), "", "캐릭터가 그곳을 물었으면 대답");
  assert.equal(hardOf({ narration: '로렌스는 숨을 골랐다. "제단은 예전에 향냄새가 났어요."' }, info({ npcRecent: past })), "", "권유가 아니면 통과");
  // 없는 이름 · 게임 밖 낱말
  assert.match(hardOf({ narration: '로렌스는 제퍼슨의 말에 걸음을 멈췄다. "침착하긴요."' }, info()), /없는 이름\(제퍼슨\)/);
  for (const ok of ["로렌스는 이예준의 말에 걸음을 멈췄다.", "로렌스는 예준의 말에 걸음을 멈췄다.", "로렌스는 상대의 말에 걸음을 멈췄다."])
    assert.doesNotMatch(hardOf({ narration: ok }, info()), /없는 이름/, ok);
  assert.doesNotMatch(hardOf({ narration: "로렌스는 수도사의 말에 걸음을 멈췄다." }, info({ known: "늙은 수도사가 다가왔다." })), /없는 이름/, "기록에 나온 낱말");
  assert.match(hardOf({ narration: '로렌스는 벽을 짚었다. "힌트라도 찾아야죠."' }, info()), /게임 밖 낱말\(힌트\)/);
  assert.equal(JSON.stringify(Turn.gestures("로렌스는 고개를 내저었다.", ["로렌스"], ["이예준"])), JSON.stringify({ 로렌스: ["고개를 저음"] }));
});

test("지시문: 힌트 한 번 · 실패한 판정 단서 확정 금지 · NPC 도구 · 없는 이름", () => {
  const sys = AI.gmSystem({ tone: "prose" });
  for (const re of [/"지금줄힌트"가 있으면 이번 서술에 한 번만/, /NPC\(KPC 포함\)의 입으로도 사실로 확정하지 않는다/, /새로 꺼내 쓰지 않는다/, /없는 사람 이름을 쓰지 않는다/, /소설체 과거형/, /"아직안검"/, /게임 밖 낱말/])
    assert.match(sys, re);
});

test("길티마스 재현: 소설체 현재형 문장은 재요청, 마지막은 통과", () => {
  const info = base({ tone: "prose" });
  const obj = { narration: "로니는 손바닥을 들어 불빛에 비춰보았다. 손톱 밑이 검붉게 물들어 있고 기괴한 변화가 눈에 들어온다." };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /현재형/.test(i.msg)));
  assert.ok(!run(obj, info, true).issues.some((i) => i.hard));
  assert.ok(!run({ narration: "로니는 손바닥을 들어 불빛에 비춰보았다. 기괴한 변화가 눈에 들어왔다." }, info).issues.some((i) => /현재형/.test(i.msg)));
});

test("길티마스 재현: 직전 차례 문장을 거의 그대로 되풀이하면 재요청, 마지막은 그 문장 삭제", () => {
  const info = base({ prevSents: ["손바닥을 들어 불빛에 비춰보자, 손톱 밑이 검붉게 물들어 있고 피부 아래로 무언가 꿈틀거리는 듯한 기괴한 변화가 눈에 들어왔다."] });
  const obj = { narration: "자신의 손바닥을 불빛에 비춰보자, 손톱 밑이 검붉게 물들어 있고 피부 아래로 무언가 꿈틀거리는 기괴한 변화가 눈에 들어왔다. 창밖에서 바람이 울었다." };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /직전 서술/.test(i.msg)));
  const f = run(obj, info, true);
  assert.ok(!f.issues.some((i) => i.hard));
  assert.equal(f.plan.narration, "창밖에서 바람이 울었다.");
});

test("길티마스 재현: NPC가 말만 바꿔 같은 변명을 되풀이하면 재요청", () => {
  const info = base({ prevQuotes: ["\"우리가 마신 에그노그… 그게 문제야. 나도 교단이 시킨 대로만… 아니, 제발 더 묻지 마!\""] });
  const obj = { narration: "줄리언은 거친 숨을 내쉬며 고개를 가로저었다. \"…더 이상 묻지 마. 나도 위에서 시킨 대로만 한 것뿐이야!\"" };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /되풀이/.test(i.msg)));
});

test("다인 차례: 결과가 각자 행동만 적고 반응이 없으면 재요청, NPC 대사가 있으면 통과, 마지막은 통과", () => {
  const info = base({
    chars: [{ pid: "p1", name: "엘로이", player: "가", items: [] }, { pid: "p2", name: "로니", player: "나", items: [] }],
    actors: [{ pid: "p1", name: "엘로이" }, { pid: "p2", name: "로니" }], turnPids: ["p1", "p2"], order: ["p1", "p2"],
    npcNames: ["허버트"], table: true,
  });
  const echo = { narration: "", results: [{ who: "엘로이", text: "엘로이는 집에 돌아갈 수 있는지 물으며 잠긴 정문 쪽을 바라보았다." }, { who: "로니", text: "로니는 극심한 공포 속에서 살려달라며 거듭 애원했다." }] };
  assert.ok(run(echo, info).issues.some((i) => i.hard && /반응이 없음/.test(i.msg)));
  assert.ok(!run(echo, info, true).issues.some((i) => i.hard));
  const ok = { narration: "", results: [{ who: "엘로이", text: "허버트가 고개를 저었다. \"문은 밤새 열리지 않네.\"" }, { who: "로니", text: "애원은 복도에 메아리쳤다." }] };
  assert.ok(!run(ok, info).issues.some((i) => i.hard && /반응이 없음/.test(i.msg)));
});

test("서류 뭉치 재현: 입력 행동을 서술 안에서 두 번 되풀이하면 재요청, 마지막은 반복 문장 삭제", () => {
  const info = base({ inputs: ["빛바랜 서류 뭉치를 펼쳐 살펴본다"], actTexts: ["빛바랜 서류 뭉치를 펼쳐 살펴본다"] });
  const obj = { narration: "빛바랜 서류 뭉치를 펼치자, 오래된 양피지 위로 수도원의 비밀스러운 기록과 알 수 없는 기호들이 어지럽게 눈에 들어왔다. 빛바랜 서류 뭉치를 펼쳐 빽빽하게 적힌 기록들을 살펴보았다." };
  assert.ok(run(obj, info).issues.some((i) => i.hard && /두 번 되풀이/.test(i.msg)));
  const f = run(obj, info, true);
  assert.ok(!f.issues.some((i) => i.hard));
  assert.ok(!/살펴보았다/.test(f.plan.narration) && /눈에 들어왔다/.test(f.plan.narration));
});

test("질문 답이 행동 묘사뿐이면 재요청, 판정을 걸면 질문 차례에도 유지", () => {
  const info = base({ askOnly: true, askers: [{ pid: "p1", name: "한서" }], inputs: ["서류 뭉치에서 알 수 있는게 있을까?"], checks: ["k1"] });
  const empty = { narration: "", answers: [{ to: "한서", text: "서류 뭉치 속 빼곡한 기록과 기호를 훑어보며 그 의미를 가늠해 보았다." }] };
  assert.ok(run(empty, info).issues.some((i) => i.hard && /행동 묘사뿐/.test(i.msg)));
  assert.ok(!run(empty, info, true).issues.some((i) => i.hard));
  const ck = run({ ...empty, request_check: { id: "k1", who: "한서" } }, info);
  assert.ok(!ck.issues.some((i) => i.hard && /행동 묘사뿐/.test(i.msg)));
  assert.ok(ck.plan.check, "질문 차례에서도 판정 유지");
});
