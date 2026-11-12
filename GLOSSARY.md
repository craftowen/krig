# 용어집 (GLOSSARY)

이 문서는 `krig`에서 사용하는 도메인 핵심 용어의 단일 정본이다. 코드, 플레이북, 테스트, 게이트 스크립트는 모두 아래 정의와 동일한 이름을 쓴다.

- **Entry Router (`/krig`)**: 사용자가 호출하는 유일한 공개 스킬([SKILL.md](skills/krig/SKILL.md)). 요청 문장을 분류해 내부 플레이북 파이프라인을 선택하고 실행한다.
- **Playbook**: 특정 엔지니어링 단계(`align`, `recon`, `design`, `model`, `drive`, `demock`, `verify`, `slim`, `resume`, `ship`, `eval`, `backprop`)의 실행 절차서. 라우터가 선택한 플레이북만 지연 로드한다.
- **Gear (`hitl` / `afk`)**: 인간 개입 허용 기어. `hitl`은 프론티어 질문과 범위 삭제 승인을 허용하며 단독 `align`만 해당한다(`full` 파이프라인에서는 `afk`로 승격). `afk`는 파괴적 행동을 제외한 모든 가역적 판단과 실험을 자율 수행한다.
- **First Nail (`first_nail`)**: 계획 전체를 무너뜨릴 수 있는 가장 위험한 단일 기둥 가정과, 그것을 가장 싸게 반증하는 실험이다.
- **Load-Bearing Safety Fact**: 변경 전 영향도 분석(`recon`의 `blast` 모드)에서 변경이 안전하려면 반드시 성립해야 하는 단 하나의 핵심 안전 명제다. 정적 추측 대신 런타임 프로브나 실행으로 증명한다.
- **Bounded State Model**: 유한 도메인 상태 변수, 가드된 전이(`actions`), 안전 불변식(`invariants`), 필수 도달 목표(`mustReach`)로 정의된 명시적 상태 기계 명세다. [statecheck.mjs](skills/krig/scripts/statecheck.mjs)가 너비 우선 탐색(BFS)으로 최단 반례 경로와 데드락을 검증한다.
- **Deletion Ledger**: 관성 요구사항 삭제, 유지, 복구 이력을 기록하는 JSONL 원장. 복구율(`addBackRate`)이 10% 미만이면 과소 삭제 경고를 발생시킨다.
- **Decision Trail (`decisions.tsv`)**: 가설, 실행 조치, 관측 근거, 판정(`KEEP`, `REVERT`, `VERIFIED`, `NOT_VERIFIED`, `INCONCLUSIVE`, `NOTE`), 커밋 해시를 남기는 탭 구분 감사 로그다.
- **Demock Candidate**: 프로덕션 실행 경로에 침투한 테스트 더블, 예외를 삼키고 성공처럼 반환하는 블록, 입력 누락 시 통과시키는 보안 가드, 미구현 플레이스홀더 후보군이다.
- **Debt Rot Risk (`rotRisk`)**: 주석에 기록된 기술 부채나 임시 우회(`krig-debt:`, `TODO`, `FIXME`, `HACK`, `WORKAROUND`, `XXX`) 중 언제 어떻게 고칠지 전환 조건(`upgradeTrigger`)이 없어 영구 방치될 위험이 있는 항목이다.
- **Dual-Axis Verification**: 구현 결과를 코딩 표준 축(Standards 서브에이전트)과 원본 요구사항 축(Spec 서브에이전트)으로 분리해 병렬 검증하는 절차다.
- **Verification Patch Stamp (`verified.json`)**: `verify` 통과 시 기준 커밋 대비 변경분(미추적 신규 파일 포함)의 `git patch-id --stable` 해시, 바이너리/파일 모드 다이제스트, 실행 근거를 기록한 지문이다. 순수 커밋이나 리베이스는 통과시키되 미검증 추가 수정은 `STALE_VERIFICATION`으로 차단한다.
- **Handoff Checkpoint (`handoff.json`)**: 세션 중단 또는 인계 시 현재 기준/헤드 커밋, 패치 ID, 완료 항목, 다음 할 일, 차단 요인을 기록해 드리프트 진단을 가능케 하는 복구 스냅샷이다.
- **Blinded A/B Oracle**: 동일 모델, 동일 초기 시드 저장소, 블라인드 과제 프롬프트 조건에서 `no-skill` 대조군과 `with-krig` 실험군의 홀드아웃 결정론적 오라클 단언 통과율 및 결함 유출 감소를 정량 비교하는 평가 체계다([ab-eval.mjs](skills/krig/scripts/ab-eval.mjs)).
- **Enforcement Pyramid**: 반복 실수를 차단하는 우선순위 체계. 1순위 아키텍처 제거, 2순위 타입 강제, 3순위 해결책을 포함한 정적 게이트/린트, 4순위 행동 테스트, 5순위 탈도구화 `v0` 문서 역전파 순으로 적용한다.
