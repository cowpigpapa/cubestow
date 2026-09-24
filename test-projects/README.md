# Cubestow 검토용 화물 10종

각 CSV를 앱의 `파일 업로드`로 불러오면 동일한 조건을 반복 검토할 수 있다. 우선 `20ft Dry · 자동 추천 · 복합운송`으로 실행하고, 필요하면 컨테이너·전략·운송모드만 바꿔 비교한다.

| 번호 | 파일 | 검토 목적 |
|---|---|---|
| 01 | `01-single-small.csv` | 단일 소형 박스의 폭 채움과 다단 적재 |
| 02 | `02-single-medium.csv` | 단일 중형 박스의 반복 패턴과 활용률 |
| 03 | `03-single-large.csv` | 단일 대형·중량 화물의 바닥 배치 |
| 04 | `04-mixed-heavy.csv` | 중량이 다른 복합 화물의 무게중심 |
| 05 | `05-mixed-sizes.csv` | 대·중·소 혼합 화물의 빈 공간 활용 |
| 06 | `06-cylinders.csv` | 원통 적층과 좌우 구름 방향 지지 |
| 07 | `07-tall-stability.csv` | 고세장 화물의 운송모드별 안정성 |
| 08 | `08-fragile-topload.csv` | 상부 적재 금지와 누적 압축하중 |
| 09 | `09-width-combination.csv` | 서로 다른 폭 조합과 안전·폭 균형 |
| 10 | `10-partial-unloadable.csv` | 정상 화물과 과대 화물 혼합 시 부분 적재 경고 |

질문과 개선 결과는 루트의 `SIMULATION-FEEDBACK.md`에 기록한다.
