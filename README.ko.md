# krig (`/krig`)

[English](README.md) | 한국어

`krig`(`Krill` + `Rig`)는 Claude Code, Codex CLI, Antigravity(`agy`)에서 `/krig` 명령어 하나로 실행하는 자동 라우팅 엔지니어링 스킬 및 플러그인입니다.

개별 슬래시 명령 열두 개를 외울 필요 없이 `/krig <요청>`만 입력하면 진입 라우터([SKILL.md](skills/krig/SKILL.md), [route.mjs](skills/krig/scripts/route.mjs))가 요청 성격을 분류해 12개 내부 플레이북과 무의존 결정론적 검증 스크립트 중 필요한 것만 지연 로드합니다.

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
/krig parseCliFlags 시그니처 바꾸면 어디 깨지는지 영향도 분석해줘
/krig 결제 어댑터 경계와 인터페이스 설계해줘
/krig 배달 체크포인트 재시도 상태 머신에 데드락이나 중복 발송 불변식 위반 없는지 모델 체킹해줘
/krig PROJ-120 구현하고 검증까지 끝내줘
/krig 간헐적으로 타임아웃 나는 원인 이진 탐색으로 찾아서 고쳐줘
/krig 이 저장소 과잉 추상화 군살이랑 부패 위험 있는 기술 부채 원장 뽑아줘
/krig 이전 세션 하던 작업 어디까지 됐는지 파악해서 이어서 마무리해줘
/krig 출하 점검 돌리고 1분 PR 브리핑 작성해줘
/krig 스킬 쓰고 안 쓰고의 결과물 차이를 블라인드 A/B로 정량 평가해줘
/krig 이번 세션에서 고친 실수 재발 안 하게 게이트와 문서에 역전파해줘
```

특정 라우트를 강제로 지정하려면 `route:<라우트>` 접두사(예: `/krig route:recon ...`, `/krig route:model ...`, `/krig route:slim ...`, `/krig route:ship ...`, `/krig route:eval ...`)를 붙입니다.

## 12개 자동 라우팅 플레이북과 보조 도구

1. **`align` (`hitl` 기어)**: 관성 요구사항 감량 원장([ledger.mjs](skills/krig/scripts/ledger.mjs), 복구율 10% 미만 과소 삭제 경고), 첫 번째 못(`first_nail`) 반증 실험, 단일 라운드 프론티어 인터뷰, [GLOSSARY.md](GLOSSARY.md) 갱신, 수직 예광탄 티켓 분해.
2. **`recon` (`afk` 기어)**: 서브시스템 동작 원리(`how`), 커밋/픽액스 의사결정 계보 및 사실/추론/미확인 분리(`why`), 5단계 변경 영향도 증명(`blast`), 심볼/호출부/경계 추출기([recon.mjs](skills/krig/scripts/recon.mjs)).
3. **`design` (`afk` 기어, 후속 `verify`)**: 깊은 모듈 설계([deepening.md](skills/krig/references/deepening.md)), 2-어댑터 이음매 규칙, 외부 의존성 4분류, 격리 서브에이전트 후보 설계 접목.
4. **`model` (`afk` 기어, 후속 `verify`)**: 무의존 순수 Node.js 유한 상태 공간 BFS 검증기([statecheck.mjs](skills/krig/scripts/statecheck.mjs)), 데드락 및 불변식 최단 반례 추적, Mermaid 상태도 생성 및 행동 테스트 재현.
5. **`drive` (`afk` 기어, 후속 `demock`, `verify`)**: 기능 수직 슬라이스(`feature`), 런타임 계측 이진 탐색 버그 수정(`bugfix`), 고정 하네스 단일 변인 개선(`hillclimb`), 탭 구분 감사 로그([decision-log.mjs](skills/krig/scripts/decision-log.mjs)).
6. **`demock` (`afk` 기어, 후속 `verify`)**: 프로덕션 경로 테스트 더블, 삼킨 예외, 거짓 통과 보안 가드, 미구현 플레이스홀더 렉서 스캔([scan.mjs](skills/krig/scripts/scan.mjs)) 및 실패 테스트 선작성 교정.
7. **`verify` (`afk` 기어)**: Standards([standards-baseline.md](skills/krig/references/standards-baseline.md))와 Spec 2축 독립 서브에이전트 병렬 리뷰, 백지 콜드 리드, 벤치마크 8대 누수 감사([leakage-8.md](skills/krig/references/leakage-8.md)), `git patch-id` 검증 스탬프([ship-check.mjs](skills/krig/scripts/ship-check.mjs)).
8. **`slim` (`afk` 기어)**: 주석 토큰 전용 기술 부채 원장 및 전환 조건 누락 부패 위험(`rotRisk`) 검출, 미사용 의존성 및 패스스루/고아 모듈 감사([slim.mjs](skills/krig/scripts/slim.mjs)).
9. **`resume` (`afk` 기어)**: 중단 세션 상태 및 커밋/패치 드리프트 진단, 무손실 인계 체크포인트([checkpoint.mjs](skills/krig/scripts/checkpoint.mjs)).
10. **`ship` (`afk` 기어)**: 리베이스 안전 `git patch-id --stable` 검증 신선도 대조, `.krig/` 스테이징/시크릿/충돌 위생 점검, 40줄 이내 1분 PR 브리핑 검증([ship-check.mjs](skills/krig/scripts/ship-check.mjs)).
11. **`eval` (`afk` 기어)**: 블라인드 A/B 누출 검증(`check-blinding`) 및 보류된 결정론적 오라클 쌍대 비교/스코어보드 산출기([ab-eval.mjs](skills/krig/scripts/ab-eval.mjs)).
12. **`backprop` (`afk` 기어)**: 강제력 피라미드(아키텍처 / 타입 / 정적 게이트 / 행동 테스트 / 탈도구화 `v0` 문서) 역전파 및 단일 정본 검증([unwrap.mjs](skills/krig/scripts/unwrap.mjs)).

## 블라인드 정량 A/B 벤치마크 (`no-skill` 대 `with-krig`)

[benchmarks/README.md](benchmarks/README.md)에 수록된 6개 과제, 60개 보류 결정론적 단언 스위트에서 동일 모델, 동일 초기 git 커밋, 물리적 오라클 격리 조건으로 총 24회 세션을 실측한 결과입니다(인프라 오류 `0`건):

| 실행 모델 | `no-skill` 통과율 | `with-krig` 통과율 | 통과율 향상폭 | 결함 탈출 (`no-skill` 대 `with-krig`) | 쌍대 과제 결과 (`with-krig` 기준) |
|---|---|---|---|---|---|
| `claude-sonnet-5-5` (`6`과제, `60`단언) | `95.0%` (`57/60`) | **`100.0%` (`60/60`)** | **`+5.0%p`** | `2`건 대 **`0`건 (`-100%`)** | `2`승 `4`무 `0`패 (`src` 줄 수 `-4.5%`) |
| `claude-haiku-5-5` (`6`과제, `60`단언) | `93.3%` (`56/60`) | **`96.7%` (`58/60`)** | **`+3.4%p`** | `2`건 대 **`1`건 (`-50%`)** | `1`승 `4`무 `1`패 |
| **합산 (`12`쌍, `120`단언)** | `94.2%` (`113/120`) | **`98.3%` (`118/120`)** | **`+4.1%p`** | `4`건 대 **`1`건 (`-75%`)** | **`3`승 `8`무 `1`패** |

## 저장소 검증

기여 안내와 작성 규약은 [CONTRIBUTING.md](docs/CONTRIBUTING.md)를 참고하세요.

```bash
npm run check
npm test
```

## 라이선스

[MIT](LICENSE)
