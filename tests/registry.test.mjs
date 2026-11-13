import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./load.mjs";
import worker from "../server/registry/index.js";

const ROOM = "abcde12345";
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, opts = {}) => { calls.push({ url, method: opts.method }); return handler(url, opts); };
  f.calls = calls;
  return f;
}
const ok = (body) => ({ ok: true, json: async () => body });

test("Registry: 주소가 없으면 꺼짐 (모름 · 실패로 돌려주고 요청도 안 보냄)", async () => {
  const f = fakeFetch(() => ok({ deleted: true }));
  const { Registry } = load({ fetch: f });
  assert.equal(Registry.enabled, false);
  assert.equal(await Registry.isDeleted(ROOM), null);
  assert.equal(await Registry.markDeleted(ROOM), false);
  assert.equal(await Registry.revive(ROOM), false);
  assert.equal(f.calls.length, 0);
});

test("Registry: 삭제됨 · 아님 · 모름을 구분하고 알맞은 요청을 보냄", async () => {
  let reply = ok({ deleted: true });
  const f = fakeFetch(() => reply);
  const { Registry } = load({ fetch: f });
  Registry.setBase("https://reg.example.workers.dev/");
  assert.equal(Registry.enabled, true);
  assert.equal(await Registry.isDeleted(ROOM), true);
  assert.deepEqual(f.calls[0], { url: `https://reg.example.workers.dev/deleted/${ROOM}`, method: "GET" });
  reply = ok({ deleted: false });
  assert.equal(await Registry.isDeleted(ROOM), false);
  reply = { ok: false, json: async () => ({}) };
  assert.equal(await Registry.isDeleted(ROOM), null, "서버 오류 = 모름 (지우지 않음)");
  reply = ok({ unexpected: 1 });
  assert.equal(await Registry.isDeleted(ROOM), null, "모양이 다르면 모름");
  reply = ok({ deleted: true });
  assert.equal(await Registry.markDeleted(ROOM), true);
  assert.equal(f.calls.at(-1).method, "POST");
  assert.equal(await Registry.revive(ROOM), true);
  assert.equal(f.calls.at(-1).method, "DELETE");
});

test("Registry: 오프라인 · 시간 초과 · 이상한 방 코드는 모름", async () => {
  const { Registry } = load({ fetch: fakeFetch(() => { throw new TypeError("Failed to fetch"); }) });
  Registry.setBase("https://reg.example");
  assert.equal(await Registry.isDeleted(ROOM), null);
  assert.equal(await Registry.markDeleted(ROOM), false);
  const slow = load({ fetch: (url, { signal }) => new Promise((_, no) => signal.addEventListener("abort", () => no(new Error("aborted")))) }).Registry;
  slow.setBase("https://reg.example");
  assert.equal(await slow.isDeleted(ROOM, 20), null, "시간 초과");
  assert.equal(await Registry.isDeleted("../x"), null, "형식이 다른 방 코드는 요청하지 않음");
});

// ---- 등록부 서버 (Workers) ----
function kv() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k), m }; }
const hit = (env, method, path) => worker.fetch(new Request(`https://reg.example${path}`, { method }), env);

test("등록부 서버: 표시 · 확인 · 해제 · CORS · 잘못된 요청", async () => {
  const env = { ROOMS: kv() };
  assert.deepEqual(await (await hit(env, "GET", `/deleted/${ROOM}`)).json(), { deleted: false });
  const marked = await hit(env, "POST", `/deleted/${ROOM}`);
  assert.deepEqual(await marked.json(), { deleted: true });
  assert.equal(marked.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await (await hit(env, "GET", `/deleted/${ROOM}`)).json(), { deleted: true });
  assert.deepEqual(await (await hit(env, "GET", "/deleted/zzzzzzzzzz")).json(), { deleted: false }, "다른 방은 영향 없음");
  assert.deepEqual(await (await hit(env, "DELETE", `/deleted/${ROOM}`)).json(), { deleted: false });
  assert.deepEqual(await (await hit(env, "GET", `/deleted/${ROOM}`)).json(), { deleted: false });
  const pre = await hit(env, "OPTIONS", `/deleted/${ROOM}`);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-methods"), /DELETE/);
  assert.equal((await hit(env, "GET", "/deleted/ABC")).status, 404);
  assert.equal((await hit(env, "GET", "/")).status, 404);
  assert.equal((await hit(env, "PUT", `/deleted/${ROOM}`)).status, 405);
});
