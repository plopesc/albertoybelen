// Only these constants may cross the CLI boundary. Never interpolate child output.
const codes = new Set([
  'LOCAL_PREFLIGHT', 'ACCOUNT_SELECTION', 'TARGET_CONFIG',
  'PRIVATE_WORKSPACE', 'WRANGLER_EXECUTION', 'WRANGLER_TIMEOUT',
  'WRANGLER_OUTPUT_LIMIT', 'WRANGLER_COMPOUND_SELECT_LIMIT',
  'INVENTORY_RESPONSE', 'STAGING_OPERATION_FAILED',
]);
class StagingDiagnostic extends Error {
  constructor(code) {
    super(`Staging diagnostic: ${codes.has(code) ? code : 'STAGING_OPERATION_FAILED'}`);
    this.code = codes.has(code) ? code : 'STAGING_OPERATION_FAILED';
  }
}
export function atStage(code, operation) {
  try { return operation(); }
  catch (error) { throw error instanceof StagingDiagnostic ? error : new StagingDiagnostic(code); }
}
export function diagnosticCode(error) {
  return error instanceof StagingDiagnostic && codes.has(error.code) ? error.code : 'STAGING_OPERATION_FAILED';
}
export function wranglerFailure(result) {
  if (result.error?.code === 'ETIMEDOUT') return new StagingDiagnostic('WRANGLER_TIMEOUT');
  if (result.error?.code === 'ENOBUFS') return new StagingDiagnostic('WRANGLER_OUTPUT_LIMIT');
  // Wrangler 4.160.1 --json errors have {error:{text,notes:[{text}]}}.
  // Classification does not make an invalid response usable or expose its text.
  try {
    const {error} = JSON.parse(result.stdout);
    const notes = Array.isArray(error?.notes) ? error.notes : [];
    if (notes.some(note => typeof note?.text === 'string' && note.text.toLowerCase().includes('too many terms in compound select'))) {
      return new StagingDiagnostic('WRANGLER_COMPOUND_SELECT_LIMIT');
    }
  } catch { /* Unknown or partial output remains a generic execution failure. */ }
  return new StagingDiagnostic('WRANGLER_EXECUTION');
}
