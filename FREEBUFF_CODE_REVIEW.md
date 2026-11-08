# 최종 코드 리뷰: 조건 변경 직후 관련 툴팁 자동 노출(배치 방식 포함 완결판)

**검토 대상**:
- `app.js`
- `v3-projects.css`
- `test/release.test.mjs`
- 배포 캐시 반영: `index.html`의 `v3-projects.css?v=20261007-01`, `app.js?v=20261007-01`

**검토 범위**:
- 안전 수준(safetyLevel), 배치 방식(preference), 운송 경로(transportMode) select 변경 시 각 힌트 툴팁(`safetyHint`, `preferenceHint`, `transportHint`) 자동 노출
- 1500ms 자동 노출 후 hover/focus 동작 보존
- 타이머 정리, 중복 타이밍 위험, 접근성, 회귀, 테스트 적절성
- 캐시버스터 쿼리 파라미터 반영으로 브라우저에 변경본이 정상 전달되는지

**전체 결론**:
이번 최종 묶음은 요청한 의도가 깔끔하고 일관되게 구현됐다. 세 select 변경 핸들러가 모두 `markSimulationChanged()`와 함께 동일한 패턴의 `flashContextTooltip(...)`를 호출하고, 이전 리뷰에서 지적된 배치 방식(preference) 누락도 반영돼 있다. 중복 플래시 유발 지점도 정리됐고, CSS 쪽에서 hover/focus 계열 표시와 자동 노출 표시가 충돌하지 않도록 분리돼 있다. 테스트도 세 필드 자동 노출 트리거를 모두 확인하도록 보강돼 있다.

추가로 확인한 캐시버스터 반영도 문제없다. `index.html`이 `v3-projects.css?v=20261007-01`과 `app.js?v=20261007-01`을 참조하므로, 이미 검토한 툴팁 자동 노출 변경이 프로덕션 브라우저에 새 버전으로 전달된다. 쿼리 파라미터 자체도 기존 패턴(`?v=날짜- 일련번호`)과 같은 스타일이라 이상하지 않다.

---

## P0

없음.

---

## P1

### P1-1. 세 select 변경 경로가 모두 같은 자동 노출 패턴을 따른다
**파일**: `app.js`

**확인 내용**:
- `$('safetyLevel').onchange`는 `markSimulationChanged()` + `flashContextTooltip($('safetyHint'))`
- `$('preference').onchange`는 `markSimulationChanged()` + `flashContextTooltip($('preferenceHint'))`
- `$('transportMode').onchange`는 `markSimulationChanged()` + `flashContextTooltip($('transportHint'))`

세 필드 모두 같은 구조로 자동 노출이 들어가 있어서, “조건 변경 직후 관련 설명을 짧게 띄운다”는 목적이 일관되게 충족된다.

---

## P2

### P2-1. 중복 플래시 유발 지점이 없어, 같은 변경에서 여러 번 띄우는 구조가 아니다
**파일**: `app.js`

**확인 내용**:
- `enhanceSafetySlider()`의 `slider.oninput`은 값 변경 여부에 따라 렌더링만 하고, 자동 노출은 더 이상 여기서 직접 반복 호출하지 않는다. 이전처럼 `changed` 조건부로 직접 띄우는 별도 라인은 제거돼 있다.
- `enhanceSegmented()`의 버튼 클릭 핸들러도 현재는 `select.value` 변경, `change` 이벤트 dispatch, `render()`만 수행하고, 별도의 `flashContextTooltip(hint)` 호출은 남기지 않았다.
- 따라서 select 변경 경로에서는 `markSimulationChanged()`와 함께 각 `onchange` 핸들러에서만 한 번씩 자동 노출이 발생한다.

**비고**:
- 이번 최종 상태에서는 “한 번의 사용자 선택에 여러 경로에서 같은 툴팁을 반복 플래시”하는 형태는 보이지 않는다.

### P2-2. 타이머 cleanup는 WeakMap + clearTimeout + delete 조합으로 정리돼 있다
**파일**: `app.js`

**확인 내용**:
- `flashContextTooltip()`는 같은 `.context-help` 요소를 키로 하는 타이머를 `WeakMap`에 저장한다.
- 새 호출이 들어오면 기존 타이머를 `clearTimeout`으로 취소하고 다시 잡는다.
- 타이머 완료 시 `is-auto-visible`을 제거하고 `WeakMap`에서 해당 엔트리를 삭제한다.

**비고**:
- 짧은 자동 노출 용도로는 충분히 안전하다. 같은 요소에 대해 rapid change가 들어와도 오래된 타이머가 남아 툴팁이 무한히 유지되거나, 사용된 요소 참조가 무의미하게 남아 있는 형태는 아니다.

### P2-3. 자동 노출과 hover/focus 동작은 CSS에서 별도 상태로 분리돼 있다
**파일**: `v3-projects.css`

**확인 내용**:
- 표시 조건은 `.context-help:hover .context-tooltip`, `.context-help:focus-within .context-tooltip`, `.context-help.is-auto-visible .context-tooltip` 세 갈래로 나뉘어 있고, 세 상태 모두 같은 최종 표시 상태로 올라간다.
- `transition-delay`는 기본 hover 진입 시 `300ms, 300ms, 0s`이고, `:focus-within`과 `.is-auto-visible`은 `0s`로 처리돼 있다.
- 즉 자동 노출이 들어갔다고 해서 hover/focus 진입이 깨지거나, 포커스/호버 상태에서만 있어야 할 표시 규칙이 덮어쓰이지는 않는다.

**비고**:
- hover와 포커스 기반 노출은 유지되고, 자동 노출은 그 위에 별도로 깜빡이는 형태로 동작한다. 이 분리는 접근성 관점에서도 중요하다.

### P2-4. 접근성 표식 구조는 그대로 유지되고 있다
**파일**: `index.html`, `app.js`

**확인 내용**:
- 세 힌트는 모두 `role="tooltip"`, `aria-describedby` 연결을 갖고 있고, `aria-live="polite"`도 붙어 있다.
- 트리거 버튼은 `aria-label`을 갖고 있으며, CSS상에서 `:focus-visible` 윤곽도 남아 있다.
- 이번 변경은 이 기반을 무너뜨리지 않는다.

**비고**:
- 다만 자동 노출이 1500ms 후 사라지는 fleeting 알림이라는 점은 스크린리더 사용자에게 실제로 얼마나 도움이 되는지와는 별개의 제품 판단 영역이다. 코드 구조만 보면 현재 방식이 크게 틀렸다고 보긴 어렵다.

### P2-5. 회귀 위험도 좁다
**파일**: `app.js`

**확인 내용**:
- `markSimulationChanged()`의 기존 사이드 이펙트(입력 버전 증가, 결과 stale 처리, 내보내기 버튼 비활성화 등)는 그대로 유지된다.
- 새로 들어간 `flashContextTooltip()` 호출은 새 의존성을 끌어오지 않고, 기존 DOM/힌트 요소만 참조한다.
- 기존 segmented 렌더링 패턴도 `hint`를 동적으로 만들어 붙이던 방식에서, 마크업에 이미 있는 `.context-tooltip`을 쿼리해 사용하는 방식으로 정리돼 있다.

**비고**:
- 영향 범위가 작아서, 자동 노출 관련 변경이 나머지 입력·렌더링 흐름을 흔들 가능성은 낮다.

### P2-6. 테스트는 세 필드 자동 노출 트리거를 모두 확인한다
**파일**: `test/release.test.mjs`

**확인 내용**:
- 툴팁 3종 존재, `aria-describedby`/ `role="tooltip"`, CSS의 hover/focus-within/is-auto-visible 규칙, `transition-delay: 300ms`, 포커스 윤곽, `flashContextTooltip` 함수 존재, 그리고 `safetyHint`, `preferenceHint`, `transportHint` 각각에 대한 `flashContextTooltip($('...'))` 패턴까지 한 테스트에서 함께 확인한다.

**남은 테스트 공백**:
- 자동 노출 시간이 정확히 1500ms 부근인지
- 자동 노출 후 hover나 포커스가 여전히 정상 동작하는지
- 빠른 연속 변경에서 타이머가 안전하게 정리되는지

이 부분은 현재 테스트가 직접 증명하지 않는다. 다만 이번처럼 정적/구조 확인 중심의 릴리스 게이트라면, 최소한 “세 필드 모두 자동 노출 트리거를 가진다”는 Assertion까지는 들어간 상태라서 최소한의 회귀 방어는 된다.

### P2-7. 캐시버스터 반영은 배포 전달 관점에서 문제없다
**파일**: `index.html`

**확인 내용**:
- `index.html`은 `v3-projects.css?v=20261007-01`, `app.js?v=20261007-01`을 참조한다.
- 이 쿼리 파라미터는 검토된 최종 자산 버전을 브라우저에 전달하려는 용도로 보이며, 기존 빌드/참조 패턴과 어긋나지 않는다.
- 이 변경 자체가 툴팁 자동 노출 로직이나 접근성 구조를 바꾸지는 않는다. 이미 검토한 소스/스타일 변경본이 캐싱된 옛 버전 대신 도달하게 만드는 배포 보조 장치다.

**비고**:
- 캐시버스터는 기능 변경이 아니라 전달 보장용이므로, 소스/테스트 수정 없이 최종 결론을 업데이트할 때 함께 반영하면 된다.

---

## 최종 판단

- **정확성**: 세 조건 변경 시 각각 맞는 힌트가 자동 노출되도록 맞춰져 있다.
- **중복 타이밍**: select 변경 경로에서 여러 번 플래시하도록 꼬아 놓은 구조는 보이지 않는다.
- **타이머 cleanup**: WeakMap 기반 정리와 삭제까지 갖춰져 있다.
- **hover/focus 보존**: CSS 상태가 분리돼 있어 자동 노출이 hover/focus 노출을 망가뜨리지 않는다.
- **접근성/회귀/보안**: 기존 접근성 표식과 이벤트 사이드 이펙트를 해치지 않는 범위다.
- **테스트 적절성**: 최소한 핵심 대칭성(세 필드 자동 노출)은 테스트로 잡혔다. 시간 정밀도·포커스/호버 보존·rapid-fire 타이머 정리는 여전히 수동/브라우저 수준 확인이 필요한 공백으로 남는다.
- **캐시버스터**: `index.html`의 `?v=20261007-01` 반영은 이미 검토된 최종 변경본이 브라우저에 도달하도록 하며, 도입에 따른 문제는 보이지 않는다.

**한 줄 요약**:
최종 묶음은 요청대로 세 select 변경에 대해 같은 방식의 툴팁 자동 노출을 일관되게 넣었고, 중복 트리거와 누락도 정리됐으며, 테스트도 그에 맞춰 세 필드를 모두 확인한다. 캐시버스터 반영도 문제없다. 남은 격차는 동작 시간·포커스/호버 보존·타이머 정리의 직접 검증 정도다.
