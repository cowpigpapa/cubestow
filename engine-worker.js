// 적재 계산을 화면 스레드와 분리해 실행한다.
importScripts(
  'load-insights.js?v=20260930-14',
  'solution-validator.js?v=20260930-14',
  'packing-engine.js?v=20260930-14'
);
self.onmessage = event => {
  const { id, input } = event.data;
  try {
    const result = LoadwiseEngine.packShipment({
      ...input,
      onProgress: value => self.postMessage({ id, type: 'progress', value })
    });
    self.postMessage({ id, type: 'done', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error?.message || String(error) });
  }
};
