# 열린 과제

결정이나 확인이 필요한데 아직 손대지 않은 것. 끝나면 지운다.

## 바닥 선하중 기준이 CTU Code IM3 안내값보다 느슨함 (2026-10-14, Logistics Library 사실관계 점검에서 발견)

- 지금: `securing-plan.js`의 `reviewFloorLineLoad()`는 1m당 화물 중량이 20ft 4.5t, 40ft·45ft 3.0t을 넘으면 받침목 검토로 알린다(TIS-GDV 컨테이너 적재 지침 값).
- CTU Code 1498 IM3 §1.2.1.4.6, 그림 3.6 "Guide for load distribution"(정격 최대 총중량 30,480kg 기준) 1m당:
  - 20ft 4.80t, 40ft 2.21t, 45ft 1.93t
  - 정격 34,000kg이면 40ft 2.50t, 45ft 2.19t
  - "Where the mass of the cargo exceeds either the mass per linear m or per m2, the packer should contact the CTU operator."
- 영향: 40ft·45ft에서 2.21~3.0t/m(45ft는 1.93~3.0t/m) 사이 적재는 Cubestow에서 통과하지만 IM3 안내값은 넘는다.
- 정할 것: TIS-GDV 값을 유지할지, IM3 값(정격 총중량별)으로 바꿀지, 두 기준을 함께 보여 줄지.
- 근거 기록: Logistics Library 저장소 `tools/factcheck/2026-10-14c/ch3-key.json`, `ch6-ctu.json`, `a7-load-distribution.json`.
- Logistics Library 쪽 문서(CTU 해설 ch3-key, ch6-ctu)는 "Cubestow 설정값(TIS-GDV)이며 IM3 안내값보다 느슨하다"고 이미 밝혀 두었다. Cubestow 기준을 바꾸면 그 문장도 같이 고친다.

## 2026-10-20 (Logistics Library 감사에서 넘어온 것)
- CTU 해설 kr-road의 "20ft 실무 21톤" 기준은 근거가 없어 LL 본문에서는 뺐다(계산상 약 25톤, 출처는 블로그. LL은 Maersk Korea 수출 페이지 "도로 규제" 예시 20' Dry 18.0t·40' Dry 23.0t로 대체). Cubestow 쪽에는 아직 21t가 남아 있음: kr-road의 "Cubestow 설정" bullet, ch8의 Cubestow bullet, cubestow-application 요약. Cubestow 기본값·문구를 어떻게 할지 결정 필요.
- CTU 해설 제목·요약에 "Cubestow"가 남아 검색 색인에 노출됨(qlg-c 제목, ch3-key·ch5-accel·ch9-packing·ch11-after·a7-load-distribution·a7-calc 요약). 런타임 제거(stripProductNotes)가 제목·요약에는 적용되지 않고, qlg-c 도입부와 kr-road bullet 하나를 지우며, Cubestow 도면 SVG 캡션을 "AI 생성 도해"로 바꿈.
- CTU 해설 구조 정리 보류(2026-10-20): LL 감사가 CTU 해설 25편 중 4편 삭제(ch13-training, im7-manual, im2-documents, im1-consequences)와 병합(qlg-c·anchor-points → a7-securing, ch11 → ch4, ch7 → ch6, ch1-2 → ch4·개요, ch3 → 개요)을 권했지만, Cubestow가 LL의 ctu-library.js를 그대로 불러 쓰고 이 문서 주소로 직접 링크·사이트맵을 두고 있어 LL 쪽에서 문서를 지우거나 합치지 않았다(내용 정리와 용어 변경은 반영됨). 합치려면 Cubestow 링크·사이트맵·REFERENCE_DOCS를 함께 바꿔야 한다.

## 2026-10-22 (LL CTU 해설 구조 정리 반영, 운영자 결정: LL이 주도하고 Cubestow가 따른다)
- LL ctu-library.js에서 7편을 합쳤다(27→20편). 옛 id는 ctu-library.js의 MOVED가 새 해설과 절로 옮긴다(Cubestow도 같은 파일을 불러 쓰므로 링크는 깨지지 않음). Cubestow 쪽 링크·사이트맵을 새 id로 바꾸면 좋다:
  - ch7-suitability → ch6-ctu#s4, ch13-training → ch4-chain#s7, im1-consequences → cargo-cases#s3, im2-documents → ch11-after#s4, im7-manual → a7-load-distribution#s4, qlg-c → a7-securing#s5, anchor-points → a7-securing#s6
- 해설 안의 "Cubestow 적용/설정" 절 17개와 9장 마찰 표의 "Cubestow 선택지" 열을 LL에서 지웠다(stripProductNotes가 이미 숨기던 내용). Cubestow 화면에서 이 절을 따로 보여 주고 있었다면 Cubestow 쪽에 옮겨 둘 것.
- 모든 문서에 short 필드가 생겼고 SECTIONS가 4장+사례로 바뀌었다(필드 모양은 그대로).

## 2026-10-23
- LL에서 CTU 해설 "CubeStow 적용 기준"(cubestow-application) 문서를 운영자 지시로 삭제했다. 옛 주소는 ctu-library.js MOVED와 vercel 리다이렉트로 CTU 개요로 간다. CubeStow 화면에서 이 문서를 링크하거나 적용 범위 설명이 필요하면 CubeStow 쪽에 따로 두어야 한다.

## 2026-11-08 야간 점검

- [높음] `npm test` 실패 6파일(review·safety·securing·slow-securing 3개), `npm run benchmark:scenarios`도 같은 이유로 멈춤: `ReferenceError: window is not defined`. 커밋 안 된 app.js 맨 앞 Vercel Web Analytics 로더(`window.va = ...`)가 `window`·`document` 없는 vm 컨텍스트(test/support/securing-setup.mjs, test/review.test.mjs, test/safety.test.mjs, scenario-benchmark.mjs)에서 바로 실행된다. 브라우저 화면은 정상. 고칠 방향: 로더 첫 줄에 `if (typeof window === 'undefined' || typeof document === 'undefined') return;`을 두거나 vm 컨텍스트에 window·document 대역을 넣는다(analytics.test는 대역을 주므로 그대로 통과). 지금 상태로 push하면 CI(test.yml)가 이 단계에서 떨어진다.
- [중간] `prettier --check` 실패 5파일: app.js, test/analytics.test.mjs, test/release.test.mjs, v3-projects.css, visit-log.js. CI가 format:check를 돌리므로 커밋 전 `npm run format`.
- [중간] 저장소와 라이브가 어긋남: 라이브(cubestow.onharu.app)의 index.html과 스크립트·CSS가 커밋 안 된 작업본과 똑같다(작업본을 vercel CLI로 배포한 상태). 작업 브랜치는 main이 아니라 `algo/portfolio-improvements`(upstream 없음)이고 origin/main보다 1커밋 앞섬(8e099d0 IndexNow 키, push 안 됨). 로컬 main은 origin/main보다 111커밋 뒤(247b3f0, 1.1.19)라 쓰지 않는 브랜치다. HEAD의 build.mjs는 privacy·terms·robots·sitemap·IndexNow 키·네이버 확인 파일·visit-log.js를 복사하지 않고 그 파일들도 추적되지 않으므로, GitHub 기준으로 다시 빌드·배포하면 약관·SEO·방문 기록이 빠진다. 위 두 항목을 고친 뒤 묶음별로 커밋하고 origin/main에 올리고 upstream을 정할 것.
- 커밋 안 된 변경 요약(10-03~10-12, 모두 라이브에 반영됨): 약관·개인정보 페이지(terms/privacy.html, legal.css, vercel 리다이렉트·리라이트, 동의 버전 LEGAL_CONSENT_VERSION), 로그인을 Google만 남기고 이메일 OTP·Microsoft 제거, 알고리즘 점검 기록·화면 방문자 수 제거(project-store.js·project-model.js 대폭 삭제, supabase/migrations/20261003130000_disable_algorithm_flags.sql), 새 브랜드 아이콘, Vercel Analytics, ONHARU visit-log.js, robots·sitemap·네이버 확인 파일, v3-projects.css 정리와 툴팁 자동 노출, 새 테스트 5개. 기능은 끝난 상태로 보이나 위 테스트·서식 실패로 마무리가 안 됐다. ALGORITHM-ITERATION-REPORT·ALGORITHM-LEARNING·playwright.config.mjs·test-projects/README.md 4개는 줄바꿈(CRLF)만 바뀐 것이라 내용 변경 없음. loadspace-appliances-100.xlsx(08-11)와 FREEBUFF_CODE_REVIEW.md는 커밋할지 정할 것. 마이그레이션이 Supabase에 적용됐는지는 이번 점검에서 확인하지 못함.
- [중간] 한국 도로 한도 컨테이너가 앱 자체 축하중 판정과 맞지 않음: app.js `40ft-kr`·`40hc-kr`·`45hc-kr`은 maxWeight 25,000kg인데, load-insights.js `axleLoads()`는 총중량 한도 40t(ROAD_LIMITS.total)로 본다. 25t를 꽉 채우면 총중량 = 화물 25.0 + 컨테이너 3.75(HC 3.94·45ft 4.8) + 샤시 5.0 + 트랙터 9.0 = 42.75t(45ft 43.8t)라 "한국 도로 한도"로 고른 컨테이너가 자기 축하중 칸에서 '주의'로 뜬다(20ft-kr 21t는 36.0t로 여유). 40t 안에 들려면 40ft 화물 약 22.25t 이하. 정할 것: 25t가 44t(측정 오차 포함) 기준이라고 밝힐지, 한도값을 ROAD_LIMITS에서 계산해 맞출지. 위 2026-10-20 "20ft 21톤" 과제와 함께 정하면 된다.
- [낮음] 문 개구 치수를 보지 않음: `productFitIssue()`(app.js)와 엔진은 내부 치수만 본다. 표준 문 개구(건화물 약 2,340×2,280mm, HC 약 2,340×2,585mm)보다 크고 내부 높이(2,393·2,698mm)보다 작은 화물은 통과하지만 실제로는 문으로 못 넣는다. ALGORITHM-POLICY 8장에서 범위 밖으로 둔 항목이라 계산은 그대로 두고, 입력 경고나 검토 항목 한 줄만 더하는 방안.
- [낮음] library.js(312KB)는 index.html이 이제 Logistics Library의 ctu-library.js를 쓰는데도 build.mjs가 계속 dist에 복사해 /library.js로 공개되고, test/library-figures.test.mjs는 이 로컬 사본을 검사한다. 쓰지 않는 사본이면 빌드·테스트에서 빼거나 테스트 대상을 바꿀 것.
- [낮음] SPA 경로(/samples, /library/ctu-code)는 index.html을 그대로 내주고 canonical이 "/"로 고정돼 있다(app.js가 바꾸지 않음). 사이트맵에 /samples가 있어 canonical과 엇갈린다. 없는 주소도 200으로 index.html을 내준다(soft 404). 경로별 canonical을 JS로 바꾸거나 /samples를 sample-results.html(이미 canonical /samples)로 리라이트하는 방안.
- [낮음] package.json 버전이 1.1.128 그대로인데 그 뒤 변경이 라이브에 나가 있어, 바닥글 버전으로 배포본을 구별할 수 없다. 커밋할 때 버전을 올릴 것.
