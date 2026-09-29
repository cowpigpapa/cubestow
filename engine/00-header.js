// 엔진 파일의 머리: IIFE 시작. 조각들은 tools/build-engine.mjs가 이 순서로 이어 붙여 packing-engine.js를 만든다.
// Cubestow 적재 엔진: 화면(DOM)에 의존하지 않는 순수 계산 모듈.
// 브라우저 메인 스레드, Web Worker, Node 시험 환경에서 같은 코드로 동작한다.
(function (root) {
  'use strict';
