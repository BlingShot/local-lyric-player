import { measureLoudness } from './measure';
import type { LoudnessWorkerRequest, LoudnessWorkerResponse } from './types';

self.onmessage = (event: MessageEvent<LoudnessWorkerRequest>) => {
  const { id, trackId } = event.data;
  let response: LoudnessWorkerResponse;
  try { response = { id, trackId, scan: measureLoudness(event.data) }; }
  catch (error) { response = { id, trackId, error: error instanceof Error ? error.message : `The local loudness engine failed (${String(error)}).` }; }
  self.postMessage(response);
};
