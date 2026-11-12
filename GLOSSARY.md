# 용어집 (GLOSSARY)

이 문서는 `krig`에서 사용하는 도메인 핵심 용어의 단일 정본이다. 코드, 플레이북, 테스트, 게이트 스크립트는 모두 아래 정의와 동일한 이름을 쓴다.

- **Entry Router (`/krig`)**: 사용자가 호출하는 유일한 공개 스킬([SKILL.md](skills/krig/SKILL.md)). 요청 문장을 분류해 내부 플레이북 파이프라인을 선택하고 실행한다.
- **Playbook**: 특정 엔지니어링 단계(`align`, `design`, `drive`, `demock`, `verify`, `backprop`)의 실행 절차서. 라우터가 선택한 플레이북만 지연 로드한다.
- **Gear (`hitl` / `afk`)**: 인간 개입 허용 기어. `hitl`은 프론티어 질문과 범위 삭제 승인을 허용하며 `align`만 해당한다. `afk`는 파괴적 행동을 제외한 모든 가역적 판단과 실험을 자율 수행한다.
- **First Nail (`first_nail`)**: 계획 전체를 무너뜨릴 수 있는 가장 위험한 단일 기둥 가정과, 그것을 가장 싸게 반증하는 실험이다.
- **Deletion Ledger**: 관성 요구사항 삭제, 유지, 복구 이력을 기록하는 JSONL 원장. 복구율(`addBackRate`)이 10% 미만이면 과소 삭제 경고를 발생시킨다.
- **Decision Trail (`decisions.tsv`)**: 가설, 실행 조치, 관측 근거, 판정(`KEEP`, `REVERT`, `VERIFIED`, `NOT_VERIFIED`, `INCONCLUSIVE`, `NOTE`), 커밋 해시를 남기는 탭 구분 감사 로그다.
- **Demock Candidate**: 프로덕션 실행 경로에 침투한 테스트 더블, 예외를 삼키고 성공처럼 반환하는 블록, 입력 누락 시 통과시키는 보안 가드, 미구현 플레이스홀더 후보군이다.
- **Dual-Axis Verification**: 구현 결과를 코딩 표준 축(Standards 서브에이전트)과 원본 요구사항 축(Spec 서브에이전트)으로 분리해 병렬 검증하는 절차다.
- **Enforcement Pyramid**: 반복 실수를 차단하는 우선순위 체계. 1순위 아키텍처 제거, 2순위 타입 강제, 3순위 해결책을 포함한 정적 게이트/린트, 4순위 행동 테스트, 5순위 탈도구화 `v0` 문서 역전파 순으로 적용한다.
