---
name: krig
description: "단일 진입점 자동 라우팅 엔지니어링 장비. /krig 한 번 호출로 요청을 분류해 사전 감량 정렬(align), 깊은 모듈 설계(design), 과학적 구현/디버깅/성능 루프(drive), 가짜 성공 제거(demock), 2축 독립 검증(verify), 구조적 역전파(backprop) 플레이북을 자동 연결한다."
disable-model-invocation: true
---

# krig

## Goal

`/krig <요청>` 단일 호출로 작업의 불확실성과 범위를 판별해 필요한 내부 플레이북만 지연 로드하고, 범위 정렬(`hitl` 기어)과 자율 실행(`afk` 기어) 및 독립 검증을 끝까지 완주한다.

## Routing Table

| 라우트 | 기어 | 플레이북 | 자동 후속 체인 | 진입 조건 |
|---|---|---|---|---|
| `align` | `hitl` | [align.md](playbooks/align.md) | 없음 | 모호한 신규 기획, 요구사항 감량, 스펙 확정, 에픽 티켓 분해 요청 |
| `design` | `afk` | [design.md](playbooks/design.md) | `verify` | 모듈/함수 경계를 넘는 인터페이스 설계, 어댑터 이음매, 아키텍처 후보 비교 |
| `drive` | `afk` | [drive.md](playbooks/drive.md) | `demock`, `verify` | 구체적 티켓 구현(`feature`), 버그 재현/이진 탐색 수정(`bugfix`), 지표 개선 루프(`hillclimb`) |
| `demock` | `afk` | [demock.md](playbooks/demock.md) | `verify` | 프로덕션 경로 테스트 더블, 삼킨 예외, 거짓 통과 가드, 미구현 플레이스홀더 점검 및 제거 |
| `verify` | `afk` | [verify.md](playbooks/verify.md) | 없음 | Standards/Spec 2축 병렬 리뷰, 백지 콜드 리드, 실행 재현 검증, 벤치마크 누수 감사 |
| `backprop` | `afk` | [backprop.md](playbooks/backprop.md) | 없음 | 반복 실수나 사용자 교정을 강제력 피라미드와 단일 정본 `v0` 문서로 역전파 |

명시적 라우트 강제는 `route:<라우트> <요청>` 또는 `<라우트>: <요청>` 접두사(`align`, `design`, `drive`, `demock`, `verify`, `backprop`, `full`)를 기본으로 쓰며, 단독 라우트 단어 호출이나 한국어/티켓/파일 경로 앞의 라우트 단어도 동일하게 우선 적용한다.

## Workflow

1. 이 `SKILL.md`가 위치한 폴더를 `<SKILL_DIR>`로 두고, 셸 치환 사고(백틱, `$` 확장)를 막기 위해 싱글쿼트 히어독(`--stdin`)으로 분류 스크립트를 실행한다.

```bash
node "<SKILL_DIR>/scripts/route.mjs" --json --stdin <<'EOF'
<사용자 요청 원문>
EOF
```

2. 출력된 `steps` 배열 순서대로 해당 `playbookPath` 파일만 읽고 실행한다. 선택되지 않은 플레이북과 `references/` 문서는 메인 컨텍스트에 미리 읽지 않는다.
3. 실행 중 생성하는 임시 상태 파일(`.krig/deletion-ledger.jsonl`, `.krig/decisions.tsv`)은 작업 공간의 `.krig/` 아래에 두며, 사용자가 감사 이력 커밋을 명시적으로 요청하지 않는 한 저장소 커밋에 포함하지 않는다.
4. `drive` 진입 시 작업 시작 시점의 기준 커밋(`BASE_SHA="$(git rev-parse HEAD)"`)을 기록해 두고, 다중 커밋이 발생하더라도 후속 `demock`과 `verify`가 `BASE_SHA` 대비 전체 변경 집합을 빠짐없이 검사하게 한다.
5. 서브에이전트를 호출하는 플레이북(`align` 사실 조사, `design` 병렬 후보, `verify` 2축 리뷰 및 콜드 리드)은 현재 호스트 규칙을 따른다.
   - **Antigravity (`agy`)**: 읽기 전용 조사와 리뷰는 `TypeName: "research"`로 격리하고, 모든 서브에이전트 호출에 `pro`나 `flash` 대신 반드시 `Model: "inherit"`를 넘긴다. 리뷰 서브에이전트가 모델명을 출력해야 하면 부모 세션의 실제 모델명을 프롬프트에 직접 적는다.
   - **Claude Code**: 읽기 전용 도구만 허용한 새 `Agent` 컨텍스트로 호출하며 이전 서브에이전트를 재사용하지 않는다.
   - **Codex CLI**: 서브에이전트 도구 또는 격리된 `codex exec -C "$PWD" -s read-only` 호출로 컨텍스트를 분리한다.
6. 실행 중 새로운 반복 실수 패턴을 발견해 고쳤다면 마지막에 [backprop.md](playbooks/backprop.md) 절차로 구조적 가드레일을 남긴다.

## Rules

- **기어 분리.** `align`(`hitl` 기어)에서만 요구사항 감량안과 프론티어 의사결정을 한 라운드로 묶어 질문한다. `afk` 기어 라우트(`design`, `drive`, `demock`, `verify`, `backprop`, 그리고 `full` 모드의 `align`)에서는 가역적 선택과 코드/실험으로 관찰 가능한 사실을 인간에게 묻지 않고 직접 확인한다. 단, 권한/자격증명 부재나 코드로 알 수 없는 비가역 정책 공백에 막히면 추측으로 덮지 않고 차단 사유를 `미확인`으로 보고한다.
- **파괴적 작업 정지.** 공유 브랜치 강제 푸시, 프로덕션 데이터 삭제, 실서버 배포, 외부 고객 메시지 발송, 과금 확정 작업은 기어와 무관하게 실행 전 확인을 받는다.
- **데이터 형태 우선.** 코드를 쓰기 전에 핵심 데이터 구조(상태 머신, 레지스트리 테이블, 판별 유니온, 경계 파서)를 먼저 이름 짓고 정의한다. 입력 검증은 시스템 경계(CLI, 네트워크, 설정 파서)에서만 수행하고 내부 함수는 순수 변환으로 유지한다.
- **영구 정본 제한.** 저장소에 영구 커밋하는 산출물은 도메인 용어집(`GLOSSARY.md`), 비가역 `ADR`, 재실행 가능한 검증/레버 스크립트, 실패 테스트 코퍼스 4종뿐이다.
- **응답 형식.** 최종 답은 모든 도구 호출이 끝난 뒤 마지막에 한 번만 작성하며 첫 줄에 결론(무엇을 했고 검증 결과가 어떠한지)을 적는다. 산문에 가운뎃점, 긴 대시, 짧은 대시, 장식 화살표, 이모지 글머리표를 쓰지 않는다.

## Verification

- 모든 완료 보고 전 활성 플레이북이 요구하는 결정론적 스크립트(`scan.mjs`, `decision-log.mjs verify`, 프로젝트 테스트 및 빌드 명령)를 직접 실행하고 종료 코드와 실제 출력을 확인한다.
- 확인하지 못한 항목은 완료로 포장하지 않고 `미확인`과 구체적 사유를 명시한다.
