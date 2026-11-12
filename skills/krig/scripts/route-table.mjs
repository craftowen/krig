export const ROUTE_TABLE = Object.freeze([
  Object.freeze({
    id: 'align',
    gear: 'hitl',
    playbook: 'playbooks/align.md',
    references: Object.freeze([]),
    scripts: Object.freeze(['scripts/ledger.mjs']),
    chain: Object.freeze([]),
    summary: '관성 요구사항 감량, 첫 번째 못 반증 실험, 프론티어 인터뷰, GLOSSARY 갱신, 수직 티켓 발행'
  }),
  Object.freeze({
    id: 'design',
    gear: 'afk',
    playbook: 'playbooks/design.md',
    references: Object.freeze(['references/deepening.md']),
    scripts: Object.freeze([]),
    chain: Object.freeze(['verify']),
    summary: '깊은 모듈 경계 설계, 2-어댑터 이음매, 의존성 4분류, 병렬 후보 설계 접목'
  }),
  Object.freeze({
    id: 'drive',
    gear: 'afk',
    playbook: 'playbooks/drive.md',
    references: Object.freeze([]),
    scripts: Object.freeze(['scripts/decision-log.mjs']),
    chain: Object.freeze(['demock', 'verify']),
    summary: '기능 수직 슬라이스, 런타임 계측 이진 탐색 버그 수정, 고정 하네스 단일 변인 개선 루프'
  }),
  Object.freeze({
    id: 'demock',
    gear: 'afk',
    playbook: 'playbooks/demock.md',
    references: Object.freeze([]),
    scripts: Object.freeze(['scripts/scan.mjs']),
    chain: Object.freeze(['verify']),
    summary: '프로덕션 경로 테스트 더블, 삼킨 예외, 거짓 통과 가드, 미구현 플레이스홀더 제거'
  }),
  Object.freeze({
    id: 'verify',
    gear: 'afk',
    playbook: 'playbooks/verify.md',
    references: Object.freeze(['references/standards-baseline.md', 'references/leakage-8.md']),
    scripts: Object.freeze([]),
    chain: Object.freeze([]),
    summary: 'Standards/Spec 2축 병렬 리뷰, 백지 콜드 리드, 다수결 배제 실행 재현 검증'
  }),
  Object.freeze({
    id: 'backprop',
    gear: 'afk',
    playbook: 'playbooks/backprop.md',
    references: Object.freeze([]),
    scripts: Object.freeze(['scripts/unwrap.mjs']),
    chain: Object.freeze([]),
    summary: '강제력 피라미드 구조 교정 및 탈도구화 v0 정본 역전파'
  })
]);

export const ROUTE_BY_ID = new Map(ROUTE_TABLE.map((entry) => [entry.id, entry]));
