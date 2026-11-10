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
      (Peer.all ??= []).push(this);
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

test("가짜 PeerJS: 접속 → hello, 같은 키로 재접속하면 같은 자리", async () => {
  const { Peer } = fakeNet();
  const m = load({ Peer });
  const { data, h } = host(m, Peer);
  await wait();
  const got = [];
  const p1 = m.Net.joinRoom("room000001", { key: KEY, name: "가", onMessage: (x) => got.push(x.t), onStatus: () => {} });
  await wait(80);
  assert.ok(got.includes("hello") && got.includes("snap"));
  p1.stop(); await wait();
  const p2 = m.Net.joinRoom("room000001", { key: KEY, name: "가", onMessage: () => {}, onStatus: () => {} });
  await wait(80);
  assert.equal(Object.keys(data.players).length, 2);
  p2.stop(); h.stop();
});

test("플레이어 peer의 open이 다시 와도(중개 서버 재연결) 연결을 새로 만들지 않음", async () => {
  const { Peer } = fakeNet();
  let made = 0;
  class P2 extends Peer { connect(id) { made++; return super.connect(id); } }
  const m = load({ Peer: P2 });
  const { h } = host(m, P2);
  await wait();
  const p = m.Net.joinRoom("room000001", { key: KEY, name: "가", onMessage: () => {}, onStatus: () => {} });
  await wait(80);
  assert.equal(made, 1);
  // 중개 서버 재연결 흉내: 모든 플레이어 peer에 open을 한 번 더
  for (const x of P2.all ?? []) x.emit("open");
  await wait(80);
  assert.equal(made, 1);
  p.stop(); h.stop();
});

test("추방: 같은 키 거절 · 흔적 정리", async () => {
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
  assert.equal(g.onConnect("c2", { key: "a".repeat(16), name: "가 나", build: m.APP_BUILD }).ok, false);   // 같은 키는 거절
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
