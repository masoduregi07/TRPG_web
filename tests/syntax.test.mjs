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

test("CDN: 정확한 버전 + SRI + crossorigin", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const tags = [...html.matchAll(/<(?:script|link)\b[^>]*cdn\.jsdelivr\.net[^>]*>/g)].map((m) => m[0]);
  assert.ok(tags.length >= 2);
  for (const t of tags) {
    assert.match(t, /@\d+\.\d+\.\d+\//, `버전 고정 필요: ${t}`);
    assert.match(t, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, `integrity 필요: ${t}`);
    assert.match(t, /crossorigin="anonymous"/, `crossorigin 필요: ${t}`);
  }
});

test("Galmuri: 저장소의 글꼴 파일을 가리킴", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const urls = [...html.matchAll(/url\("(fonts\/[^"]+\.woff2)"\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 5);
  for (const u of urls) assert.doesNotThrow(() => readFileSync(new URL(`../${u}`, import.meta.url)), `없는 글꼴: ${u}`);
});
