import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { scriptSource } from "./load.mjs";

test("인라인 스크립트 구문", () => {
  assert.doesNotThrow(() => new vm.Script(scriptSource, { filename: "index.html#script" }));
});

test("HTML id 중복 없음", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, []);
});

test("JS가 찾는 #id는 모두 HTML에 있음", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  const ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = new Set([...scriptSource.matchAll(/\$\("#([A-Za-z][\w-]*)"\)/g)].map((m) => m[1]));
  const missing = [...wanted].filter((id) => !ids.has(id) && !scriptSource.includes(`id: "${id}"`) && !scriptSource.includes(`id:"${id}"`));
  assert.deepEqual(missing, []);
});
