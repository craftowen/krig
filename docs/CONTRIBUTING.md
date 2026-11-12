# Contributing to krig

`krig`는 Claude Code, Codex CLI, Antigravity(`agy`)에서 `/krig` 단일 슬래시 명령(Codex에서는 `$krig` 포함)으로 동작하는 자동 라우팅 엔지니어링 스킬 및 플러그인 패키지다.

## 1. 핵심 설계 원칙

1. **단일 진입점 자동 라우팅.** 사용자는 `/krig <요청>` 하나만 호출한다. 진입 문서인 [SKILL.md](../skills/krig/SKILL.md)와 분류 스크립트인 [route.mjs](../skills/krig/scripts/route.mjs)가 요청 성격을 판별해 12개 내부 플레이북(`align`, `recon`, `design`, `model`, `drive`, `demock`, `verify`, `slim`, `resume`, `ship`, `eval`, `backprop`) 중 필요한 것만 지연 로드한다.
2. **인간 개입 기어 분리.** 범위가 불명확한 신규 기획에서만 단독 `align`(`hitl` 기어)이 프론티어 질문과 요구사항 감량 승인을 수행한다(`full` 파이프라인으로 진입하면 `afk`로 승격). 범위가 확정된 나머지 11개 라우트(`afk` 기어)에서는 가역적 작업과 실험으로 관찰 가능한 사실에 대해 질문하지 않고 끝까지 수행한다. 파괴적 행동(공유 브랜치 강제 푸시, 프로덕션 삭제, 배포, 외부 메시지 발송, 과금 확정)만 실행 전에 멈춘다.
3. **컨텍스트 압박 분리.** 상시 문서와 진입 라우터에는 내비게이션 포인터와 경계 규칙만 둔다. 상세 코딩 표준과 Fowler 코드 스멜 12종은 구현 에이전트가 아니라 `verify` 플레이북의 Standards 리뷰 서브에이전트에만 주입한다.
4. **영구 정본 4종.** 도메인 용어집([GLOSSARY.md](../GLOSSARY.md)), 비가역 아키텍처 결정(`ADR`), 재실행 가능한 스크립트, 실패 테스트 코퍼스만 영구 보존한다. 패치가 누적된 문서는 예외 절을 덧붙이지 않고 첫 버전(`v0`)처럼 다시 쓴다.

## 2. 문서 및 스킬 작성 규칙

- **선도 단어 우선.** 에이전트가 취할 행동과 도구를 문장 앞에 긍정문으로 적는다. 무엇을 하지 말라는 긴 부정문 나열 대신 해야 할 정확한 절차를 적는다.
- **무효 문장 제거.** 구체적 행동이나 판정 기준을 바꾸지 못하는 추상적 수식어는 삭제한다.
- **기호 금칙.** 모든 마크다운 산문에서 가운뎃점, 긴 대시, 짧은 대시, 장식용 화살표, 이모지 글머리표를 쓰지 않는다. 쉼표, 마침표, 콜론, 슬래시, 줄바꿈만 쓴다.
- **호출 레인 일관성.** 사용자 명시 호출 전용 스킬은 `SKILL.md` frontmatter의 `disable-model-invocation: true`와 `agents/openai.yaml`의 `allow_implicit_invocation: false`를 반드시 쌍으로 맞춘다.
- **심볼릭 링크 안전 진입점.** `skills/krig/scripts/` 최상위의 모든 CLI 보조 스크립트(`.mjs`)는 심볼릭 링크 경로 호출과 모듈 `import` 시 부수효과 없는 로드를 보장하기 위해 `isCliMain(import.meta.url)` 진입 가드와 `--help` 종료 코드 `0`을 갖춘다. 공용 내부 모듈은 `skills/krig/scripts/lib/` 아래에 둔다.

## 3. 필수 검증 명령

변경 후에는 반드시 아래 검증 명령들의 종료 코드 `0`을 확인한다. 로컬 심볼릭 링크를 설치한 개발 환경(`./scripts/install.sh`)에서는 `./scripts/install.sh --check`까지 함께 확인한다.

```bash
npm run check
npm test
```
