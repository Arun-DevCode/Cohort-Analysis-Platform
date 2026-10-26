import { parseWorkbook } from '../core/parsers/workbookParser';

self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; fileName: string; thresholds?: { high: number; medium: number } }>) => {
  const { buffer, fileName, thresholds } = e.data;
  try {
    const result = await parseWorkbook(buffer, fileName, thresholds);
    self.postMessage({ type: 'SUCCESS', result });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown parsing error';
    self.postMessage({ type: 'ERROR', error: errorMessage });
  }
};
