// index.html의 인라인 <script>에서 화면과 무관한 로직(Rules ~ Net)만 떼어 node vm에서 불러옴
import { readFileSync } from "node:fs";
import vm from "node:vm";
import yaml from "js-yaml";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
export const scriptSource = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n;\n");
const cut = scriptSource.indexOf("function createScene3D(");
if (cut < 0) throw new Error("createScene3D 위치를 못 찾음 (로직/화면 경계)");
const head = scriptSource.slice(0, scriptSource.lastIndexOf("/* ====", cut));

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
}

/** 새 격리 환경에서 모듈을 불러옴. extra로 fetch 같은 전역을 바꿔 끼움 */
export function load(extra = {}) {
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone, performance,
    crypto: globalThis.crypto, URL, TextEncoder, TextDecoder, AbortController, Event,
    CustomEvent: class extends Event { constructor(t, o) { super(t); this.detail = o?.detail; } },
    localStorage: memStore(), sessionStorage: memStore(), location: { protocol: "https:", href: "https://x/" },
    dispatchEvent: () => true, addEventListener: () => {}, jsyaml: yaml, TRPG_AI_WAIT_MS: 5,
    ...extra,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return vm.runInContext(`${head}\n;({ Rules, Engine, Maps, WebFeatures, AI, Turn, HostGame, Net, APP_BUILD, SAMPLE_COC_YAML })`, ctx, { filename: "index.html#script" });
}

/** 샘플 시나리오 (매번 새 객체) */
export function sample(m) {
  const sc = yaml.load(m.SAMPLE_COC_YAML);
  sc.system ??= "coc7";
  return sc;
}
