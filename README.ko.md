# krig (`/krig`)

[English](README.md) | 한국어

`krig`(`Krill` + `Rig`)는 Claude Code, Codex CLI, Antigravity(`agy`)에서 `/krig` 명령어 하나로 실행하는 자동 라우팅 엔지니어링 스킬 및 플러그인입니다.

개별 슬래시 명령 여러 개를 외울 필요 없이 `/krig <요청>`만 입력하면 진입 라우터([SKILL.md](skills/krig/SKILL.md), [route.mjs](skills/krig/scripts/route.mjs))가 요청 성격을 분류해 필요한 내부 플레이북과 결정론적 검증 스크립트만 지연 로드합니다.

## 설치 방법 (3대 CLI)

Node.js 20 이상이 필요합니다. 플러그인 설치와 로컬 심볼릭 링크 설치를 모두 지원합니다.

### 1. Claude Code CLI (`claude`)

대화창 안에서 한 줄로 설치할 수 있습니다.

```text
/plugin install krig --marketplace craftowen/krig
```

또는 터미널 CLI에서 설치합니다.

```bash
claude plugin marketplace add craftowen/krig
claude plugin install krig@krig
```

### 2. Codex CLI (`codex`)

```bash
codex plugin marketplace add craftowen/krig
codex plugin add krig@krig
```

### 3. Antigravity CLI (`agy`)

```bash
agy plugin install https://github.com/craftowen/krig
```

### 4. 로컬 클론 및 3대 CLI 동시 심볼릭 링크 설치

하나의 로컬 저장소를 Claude Code, Codex CLI, Antigravity 전체에 동시에 연결할 때 사용합니다.

```bash
git clone https://github.com/craftowen/krig.git
cd krig
./scripts/install.sh
./scripts/install.sh --check
```

## 사용 방법

Claude Code와 Antigravity에서는 `/krig`(플러그인 네임스페이스 환경에서는 `/krig:krig`), Codex에서는 `$krig` 또는 `/krig`로 호출합니다.

```text
/krig 새 정산 파이프라인 요구사항 감량하고 수직 슬라이스 티켓으로 쪼개줘
/krig 결제 어댑터 경계와 인터페이스 설계해줘
/krig PROJ-120 구현하고 검증까지 끝내줘
/krig 간헐적으로 타임아웃 나는 원인 이진 탐색으로 찾아서 고쳐줘
/krig 파서 처리량 25% 개선 루프 돌려줘
/krig 방금 수정한 코드에 가짜 성공이나 삼킨 예외 없는지 검증해줘
/krig 이번 세션에서 고친 실수 재발 안 하게 게이트와 문서에 역전파해줘
```

특정 라우트를 강제로 지정하려면 `route:<라우트>` 접두사(예: `/krig route:align ...`, `/krig route:verify ...`)를 붙입니다.

## 6개 자동 라우팅 플레이북과 보조 도구

1. **`align` (`hitl` 기어)**: 관성 요구사항 감량 원장([ledger.mjs](skills/krig/scripts/ledger.mjs), 복구율 10% 미만 과소 삭제 경고), 첫 번째 못(`first_nail`) 반증 실험, 단일 라운드 프론티어 인터뷰, [GLOSSARY.md](GLOSSARY.md) 갱신, 수직 예광탄 티켓 분해.
2. **`design` (`afk` 기어, 후속 `verify`)**: 깊은 모듈 설계([deepening.md](skills/krig/references/deepening.md)), 2-어댑터 이음매 규칙, 외부 의존성 4분류, 격리 서브에이전트 후보 설계 접목.
3. **`drive` (`afk` 기어, 후속 `demock`, `verify`)**: 기능 수직 슬라이스(`feature`), 런타임 계측 이진 탐색 버그 수정(`bugfix`), 고정 하네스 단일 변인 개선(`hillclimb`), 탭 구분 감사 로그([decision-log.mjs](skills/krig/scripts/decision-log.mjs)).
4. **`demock` (`afk` 기어, 후속 `verify`)**: 프로덕션 경로 테스트 더블, 삼킨 예외, 거짓 통과 보안 가드, 미구현 플레이스홀더 렉서 스캔([scan.mjs](skills/krig/scripts/scan.mjs)) 및 실패 테스트 선작성 교정.
5. **`verify` (`afk` 기어)**: Standards([standards-baseline.md](skills/krig/references/standards-baseline.md))와 Spec 2축 독립 서브에이전트 병렬 리뷰, 백지 콜드 리드, 다수결 배제 실행 재현 판정, 벤치마크 8대 누수 감사([leakage-8.md](skills/krig/references/leakage-8.md)).
6. **`backprop` (`afk` 기어)**: 강제력 피라미드(아키텍처 / 타입 / 정적 게이트 / 행동 테스트 / 탈도구화 `v0` 문서) 역전파 및 단일 정본 검증([unwrap.mjs](skills/krig/scripts/unwrap.mjs)).

## 저장소 검증

기여 안내와 작성 규약은 [CONTRIBUTING.md](docs/CONTRIBUTING.md)를 참고하세요.

```bash
npm run check
npm test
```

## 라이선스

[MIT](LICENSE)
