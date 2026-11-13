// 삭제된 방 등록부 (Cloudflare Workers + KV). 방 코드마다 "삭제됨" 표시만 저장함
//   GET    /deleted/<방코드>  → { deleted: true|false }
//   POST   /deleted/<방코드>  → 삭제됨으로 표시 (호스트가 테이블을 지울 때)
//   DELETE /deleted/<방코드>  → 표시 해제 (같은 방 코드로 테이블을 복구할 때)
const TTL = 60 * 60 * 24 * 365;   // 1년 뒤 표시도 사라짐
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const m = new URL(req.url).pathname.match(/^\/deleted\/([a-z0-9]{10})$/);
    if (!m) return json({ error: "not found" }, 404);
    const key = `d:${m[1]}`;
    if (req.method === "GET") return json({ deleted: (await env.ROOMS.get(key)) !== null });
    if (req.method === "POST") { await env.ROOMS.put(key, String(Date.now()), { expirationTtl: TTL }); return json({ deleted: true }); }
    if (req.method === "DELETE") { await env.ROOMS.delete(key); return json({ deleted: false }); }
    return json({ error: "method not allowed" }, 405);
  },
};
