# 삭제된 방 등록부

호스트가 테이블을 지우면 방 코드를 "삭제됨"으로 적어 두고, 플레이어가 그 방을 열 때 확인해 자기 기기의 사본 · 참가 정보를 지움. 방 코드와 삭제 시각만 저장함 (내용 없음).

## 배포 (Cloudflare 계정 필요)
1. `cd server/registry && npx wrangler kv namespace create ROOMS` → 출력된 `id`를 `wrangler.toml`의 `KV_NAMESPACE_ID`에 넣음
2. `npx wrangler deploy` → 출력된 주소(`https://trpg-registry.<계정>.workers.dev`)를 복사
3. `index.html`의 `const REGISTRY_URL = "";`에 그 주소를 넣고 올림 (비워 두면 기능 꺼짐)

## 알아 둘 점
- KV는 쓰기가 다른 지역에 퍼지는 데 최대 1분쯤 걸릴 수 있음 → 지운 직후 바로 열면 못 알아챌 수 있음
- 확인에 실패(오프라인 · 서버 오류)하면 "삭제 안 됨"으로 보고 아무것도 지우지 않음
