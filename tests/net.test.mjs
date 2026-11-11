import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { load, sample } from "./load.mjs";

// 메모리 안 가짜 PeerJS: id로 찾아 연결, 데이터는 JSON 복사해 비동기로 전달
function fakeNet() {
  const peers = new Map();
  class Conn extends EventEmitter {
    constructor() { super(); this.open = false; this.other = null; }
    send(m) {
      if (!this.open) throw new Error("closed");
      const o = this.other;
      // 실제 PeerJS처럼: json은 16,300바이트 넘으면 보내지 않고 error, binary는 조각으로 나눠 그대로 전달(undefined → null)
      if (this.ser === "json" && new TextEncoder().encode(JSON.stringify(m)).byteLength >= 16300) return void setTimeout(() => this.emit("error", { type: "message-too-big" }), 0);
      const d = this.ser === "binary" ? JSON.parse(JSON.stringify(m, (k, v) => v === undefined ? null : v)) : JSON.parse(JSON.stringify(m));
      setTimeout(() => o.open && o.emit("data", d), 0);
    }
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
    connect(id, opts = {}) {
      const a = new Conn(), b = new Conn(); a.other = b; b.other = a;
      a.ser = b.ser = opts.serialization ?? "binary"; (Peer.made ??= []).push(opts);
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

test("추방 기능 없음: 예전 세이브의 추방 목록은 지우고 같은 키도 다시 들어옴", () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "h".repeat(24), hostPlays: false, mode: "human", scenario: sc });
  data.banned = ["a".repeat(16)];
  const save = m.HostGame.checkSave(JSON.parse(JSON.stringify(data)));
  assert.equal("banned" in save, false);
  const g = new m.HostGame(save, { transport: { send() {}, close() {} }, onLocal() {} });
  assert.equal(g.onConnect("c1", { key: "a".repeat(16), name: "가 나", build: m.APP_BUILD }).ok, true);
  g.hostAction({ t: "kick", pid: Object.keys(save.players).find((id) => id !== save.hostPid) });
  assert.equal(Object.keys(save.players).length, 2);   // kick 메시지는 무시
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

test("플레이어는 binary로 접속 · 16KB 넘는 기록도 끊기지 않고 도착", async () => {
  const { Peer } = fakeNet();
  const m = load({ Peer });
  const { data, game, h } = host(m, Peer);
  const line = "짙은 안개 속에서 바르톨이 그물을 내려놓고 천천히 고개를 듦. 등대 쪽을 흘끗 본 뒤 낮게 중얼거림.";
  for (let i = 0; i < 150; i++) game.addLog({ kind: "ai", text: `${line} ${i}` });
  await wait();
  let init = null;
  const p = m.Net.joinRoom("room000001", { key: KEY, name: "가", onMessage: (x) => { if (x.t === "loginit") init = x; }, onStatus: () => {} });
  await wait(100);
  assert.equal(Peer.made.at(-1).serialization, "binary");
  assert.ok(init && init.entries.length >= 150);
  const pid = Object.keys(data.players).find((k) => !data.players[k].isHost);
  assert.ok(game.online(pid));
  p.stop(); h.stop();
});

test("보낼 때 JSON 모양으로 정리: 빈 칸은 빠지고 Infinity는 null", async () => {
  const { Peer } = fakeNet();
  const m = load({ Peer });
  const { data, game, h } = host(m, Peer);
  await wait();
  const got = [];
  const p = m.Net.joinRoom("room000001", { key: KEY, name: "가", onMessage: (x) => got.push(x), onStatus: () => {} });
  await wait(80);
  const pid = Object.keys(data.players).find((k) => !data.players[k].isHost);
  game.emit(pid, { t: "probe", a: undefined, b: Infinity, c: null });
  await wait(30);
  const x = got.find((g) => g.t === "probe");
  assert.ok(x && !("a" in x));
  assert.equal(x.b, null);
  assert.equal(x.c, null);
  p.stop(); h.stop();
});

test("큰 메시지 오류(message-too-big)로는 연결을 끊지 않음", async () => {
  const { Peer } = fakeNet();
  class J extends Peer { connect(id, o) { return super.connect(id, { ...o, serialization: "json" }); } }   // 예전 json 플레이어
  const m = load({ Peer: J });
  const { data, game, h } = host(m, J);
  await wait();
  const p = m.Net.joinRoom("room000001", { key: KEY, name: "가", onMessage: () => {}, onStatus: () => {} });
  await wait(80);
  const pid = Object.keys(data.players).find((k) => !data.players[k].isHost);
  game.emit(pid, { t: "big", s: "가".repeat(9000) });
  await wait(50);
  assert.ok(game.online(pid));
  p.stop(); h.stop();
});

test("보관함 요청은 입력 횟수 제한과 따로 셈", () => {
  const m = load();
  const sc = sample(m); m.Engine.validateScenario(sc);
  const data = m.HostGame.create({ roomId: "room000001", hostName: "호스트", hostKey: "h".repeat(24), hostPlays: false, mode: "human", scenario: sc });
  let closed = false;
  const g = new m.HostGame(data, { transport: { send() {}, close() { closed = true; } }, onLocal() {}, readHistory: async () => [] });
  g.onConnect("c1", { key: "a".repeat(16), name: "가", build: m.APP_BUILD });
  for (let i = 0; i < 70; i++) g.onMessage("c1", { t: "history", requestId: `r${i}`, before: null });
  assert.equal(closed, false);
  assert.equal((g.rate.get("c1") ?? []).length, 0);
});
