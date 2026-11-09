# TRPG 테이블 (단일 index.html)

## 작업 방식
- 답변: 단답형 개조식(~함/~임). 업데이트 보고는 "병합 완료 (PR #n). 변경: 한 줄. 테스트: 한 줄."
- 시안·분석처럼 판단이 필요할 때만 길게. 시안은 이미지 목업(Playwright 렌더)로 제시
- 수정은 작은 단위: 브랜치 → 구문 검사 → 푸시 → PR(REST `gh api`, GraphQL 불가) → squash 병합
- 구문 검사: `<script>` 인라인 블록을 합쳐 `node --check`
- 커밋 메시지·PR 본문은 한두 줄. 브라우저 실제 테스트는 사용자가 함 → 미테스트면 그렇게 보고
- 새 기능은 하지 말고 요청된 것만. 불필요한 UI 문구 추가 금지 (예: "자동 분류" 라벨)

## 구조
- 한 파일: CSS + JS 인라인. 외부: PeerJS, js-yaml, Galmuri 폰트(CDN)
- 호스트 브라우저가 서버(`HostGame`), 플레이어는 PeerJS로 접속(`Net`). 호스트 ID `trpgtable-v1-<room>-host`
- 모듈: `Rules`(CoC 7e) · `Engine`(시나리오 검증/상태/뷰) · `AI`(호출·프롬프트·parseGM) · `Turn`(AI 응답 검증) · `WebFeatures`(단서 표시 등)
- AI 흐름: `queueAI`(8초 모음, 입력마다 +5초 연장, 최대 20초) → `runAI` → `turnContext` → `askGM` → `Turn.validate` → `applyPlan`
- 저장: IndexedDB(호스트 세이브·플레이어 사본), localStorage(설정·단서 수동 분류 `trpg:clueKind:<room>`)

## 확정된 결정
- 다인 행동: AI 입력에 행동표, 응답 `results[{who,text}]`, 로그에 `▶ 이름` 블록, 하단 "이번 차례 정리" 카드
- 플레이어 접속 직후 저장본 화면은 띠 표시 + 입력 잠금, 첫 실제 스냅샷에서 해제
- 채팅 맨 위/아래 버튼: 우측 끝, 정사각 틀 + 중앙 ▲▼ SVG
- 단서 탭: 발췌 없음. 원문 위 인물/장소 체크 칩만. 자동 분류 없음: 기본 미분류, 플레이어가 직접 체크한 것만 (기기별 저장)
- 시나리오 검증: 단서·판정 id 전역 유일/형식 오류, 공개 경로 없는 단서·미정의 플래그는 경고

## 남은 후보
- AI 출력 잘림 외 추가 개선, CSS 중복 정리 3단계 이후, CDN 버전 고정 + SRI
