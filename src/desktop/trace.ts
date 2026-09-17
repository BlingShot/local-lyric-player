import { diagnosticLog, diagnosticState, diagnosticMetric, isDebugMode } from './diagnostics';
import { redactDiagnostic } from '../../electron/log-redaction.mjs';
export function diagnosticTrace(scope: 'amll' | 'audio.decode', context: Record<string, unknown>) {
  const id = crypto.randomUUID(), started = performance.now();
  const steps: unknown[] = [];
  const step = (stage: string, status: string, data: unknown = {}, level: 'debug' | 'info' | 'warn' | 'error' = 'debug') => {
    const value = { traceId: id, ...context, stage, status, elapsedMs: Math.round(performance.now() - started), data };
    diagnosticLog(level, scope, `${stage}: ${status}`, value);
    if (isDebugMode()) {
      steps.push(redactDiagnostic(value)); if (steps.length > 64) steps.shift();
      if (scope === 'amll') diagnosticState('ttml', { traceId: id, ...context, stage, status, steps: [...steps] });
    }
  };
  return { id, step, finish(status: string, data: unknown = {}) { diagnosticMetric(`${scope}.totalMs`, Math.round(performance.now() - started)); step('Result', status, data, status === 'failed' ? 'warn' : 'info'); } };
}
export type DiagnosticTrace = ReturnType<typeof diagnosticTrace>;
