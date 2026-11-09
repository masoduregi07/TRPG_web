import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { load, sample } from "./load.mjs";

// 메모리 안 가짜 PeerJS: id로 찾아 연결, 데이터는 JSON 복사해 비동기로 전달
function fakeNet() {
  const peers = new Map();
  class Conn extends EventEmitter {
    constructor() { super(); this.open = false; this.other = null; }
    send(m) { if (!this.open) throw new Error("closed"); const o = this.other, d = JSON.parse(JSON.stringify(m)); setTimeout(() => o.open && o.emit("data", d), 0); }
    close() { if (!this.open) return; this.open = false; this.other.open = false; setTimeout(() => { this.emit("close"); this.other.emit("close"); }, 0); }
  }
  class Peer extends EventEmitter {
    constructor(id, opts) {
      super();
      if (typeof id !== "string") { opts = id; id = `p${Math.random().toString(36).slice(2)}`; }
      this.id = id; this.opts = opts; this.destroyed = false; this.disconnected = false; this.open = false;
      setTimeout(() => {
        if (peers.has(id)) return this.emit("error", { type: "unavailable-id" });
        peers.set(id, this); this.open = true; this.emit("open", id);
      }, 0);
    }
    connect(id) {
      const a = new Conn(), b = new Conn(); a.other = b; b.other = a;
      setTimeout(() => {
        const host = peers.get(id);
        if (!host) return this.emit("error", { type: "peer-unavailable" });
        a.open = b.open = true; host.emit("connection", b); a.emit("open"); b.emit("open");
      }, 0);
      return a;
    }
    reconnect() {}
    destroy() { this.destroyed = true; if (peers.get(this.id) === this) peers.delete(this.id); }
  }
  return { Peer, peers };
}
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const KEY = "abcdefghijklmnopqrstuvwx";

function host(m, net) {
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "h".repeat(24), hostPlays: false, mode: "human", scenario: sc });
  let game;
  const h = m.Net.startHost("room000001", { getGame: () => game, onStatus: () => {} });
  game = new m.HostGame(data, { transport: h.transport, onLocal: () => {} });
  return { data, game, h };
}

test("접속 확인: 처음엔 키, 다음부턴 서명만 · 호스트 증명 확인", async () => {
  const { Peer } = fakeNet();
  const m = load({ Peer });
  const { data, h } = host(m, Peer);
  await wait();
  const got = [], sent = [];
  let joined = false;
  const p1 = m.Net.joinRoom("room000001", { key: KEY, name: "가", onMessage: (x) => got.push(x.t), onStatus: () => {}, onJoined: () => { joined = true; } });
  await wait(80);
  assert.ok(got.includes("hello") && joined);
  assert.equal(Object.values(data.players).filter((p) => p.key === KEY).length, 1);
  p1.stop(); await wait();
  // 두 번째: 키 없이 서명만 → 같은 자리
  const got2 = [];
  const p2 = m.Net.joinRoom("room000001", { key: KEY, name: "가", joined: true, onMessage: (x) => got2.push(x.t), onStatus: () => {} });
  await wait(80);
  assert.ok(got2.includes("hello"));
  assert.equal(Object.keys(data.players).length, 2);
  p2.stop(); h.stop();
});

test("호스트인 척하는 피어: 키를 못 얻고 플레이어가 끊음", async () => {
  const { Peer } = fakeNet();
  const m = load({ Peer });
  // 가짜 호스트: 같은 ID로 등록해 받은 join을 기록하고 아무 증명이나 보냄
  const fake = new Peer(m.Net.hostPeerId("room000001"));
  const seen = [];
  fake.on("connection", (c) => {
    c.on("open", () => c.send({ t: "challenge", nonce: "n".repeat(24), build: m.APP_BUILD }));
    c.on("data", (x) => { seen.push(x); if (x.t === "join") c.send({ t: "hello", pid: "x", build: m.APP_BUILD, proof: "0".repeat(64) }); });
  });
  await wait();
  const got = [];
  const p = m.Net.joinRoom("room000001", { key: KEY, name: "가", joined: true, onMessage: (x) => got.push(x.t), onStatus: () => {} });
  await wait(80);
  assert.ok(seen.length && seen.every((x) => !("key" in x)));   // 키는 안 보냄
  assert.ok(got.includes("hostMismatch") && !got.includes("snap"));
  p.stop();
});

test("호스트가 키를 모르면 확인 받은 뒤에만 키 전송", async () => {
  const { Peer } = fakeNet();
  const m = load({ Peer });
  const { data, h } = host(m, Peer);
  await wait();
  let asked = 0;
  const got = [];
  const p = m.Net.joinRoom("room000001", { key: KEY, name: "가", joined: true, confirmKey: async () => (++asked, false), onMessage: (x) => got.push(x.t), onStatus: () => {} });
  await wait(80);
  assert.equal(asked, 1);
  assert.ok(got.includes("keyDeclined"));
  assert.equal(Object.keys(data.players).length, 1);
  p.stop(); h.stop();
});

test("추방: 같은 닉네임 새 자리 거절 · 흔적 정리", async () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "h".repeat(24), hostPlays: false, mode: "human", scenario: sc });
  const g = new m.HostGame(data, { transport: { send() {}, close() {} }, onLocal() {} });
  const { pid } = g.onConnect("c1", { key: "a".repeat(16), name: "가 나", build: m.APP_BUILD });
  data.portraits = { [pid]: { src: "data:image/png;base64,AA", at: 1 } };
  data.game.mapPos = { harbor_plan: { [pid]: [1, 1] } }; data.game.mapLoc = { [pid]: { hid: "harbor_plan", room: "부두" } };
  m.Engine.queuePending(data.game, { checkId: "x", who: pid });
  g.hostAction({ t: "kick", pid });
  assert.equal(data.portraits[pid], undefined);
  assert.equal(data.game.mapPos.harbor_plan[pid], undefined);
  assert.equal(data.game.pendingChecks.length, 0);
  assert.equal(g.onConnect("c2", { key: "b".repeat(16), name: "가나", build: m.APP_BUILD }).ok, false);
});

test("보관함 페이지: 이미 정리된 목록은 그대로 사용", () => {
  const m = load();
  const list = m.WebFeatures.merge([], [{ id: "a", kind: "say", seq: 1 }, { id: "b", kind: "say", seq: 2 }]);
  const p = m.WebFeatures.page(list, { pid: "x", merged: true });
  assert.equal(p.total, 2);
});

test("내 TURN 설정은 기본 ICE 앞에", () => {
  const m = load();
  m.Net.iceConfig();   // 설정 없음
  const ls = { getItem: () => JSON.stringify({ urls: "turn:a.example:3478", username: "u", credential: "p" }) };
  const m2 = load({ localStorage: { ...ls, setItem() {}, removeItem() {} } });
  const c = m2.Net.iceConfig();
  assert.equal(c.iceServers[0].urls, "turn:a.example:3478");
  assert.ok(c.iceServers.length >= 3);
});
