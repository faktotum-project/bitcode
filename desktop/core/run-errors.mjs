// Preserve real error codes across the controller/worker boundary. Codes below
// are diagnostic categories only when the originating error supplies no code.
export function runError(error, fallback = 'UNCLASSIFIED_ERROR') {
  const message = String(error?.message || error || 'Unknown error');
  const supplied = String(error?.code || error?.cause?.code || '');
  const status = Number(error?.statusCode || error?.status || message.match(/\bHTTP (\d{3})\b/)?.[1]);
  const statusCode = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const embedded = message.match(/\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPERM|EACCES|ENOENT)\b/)?.[1];
  let code = /^[A-Z][A-Z0-9_]{1,79}$/.test(supplied) ? supplied : embedded || (statusCode ? `HTTP_${statusCode}` : null);
  if (!code && /output\/context limit|context (?:window|length|overflow)|context_length_exceeded|response is incomplete/i.test(message)) code = 'MODEL_LIMIT';
  if (!code && /reached tool budget/i.test(message)) code = 'TOOL_BUDGET';
  if (!code && /steps without a final answer/i.test(message)) code = 'MAX_STEPS';
  if (!code && /missing API key/i.test(message)) code = 'MISSING_API_KEY';
  if (!code && /timed? ?out|timeout/i.test(message)) code = 'TIMEOUT';
  if (!code && error?.name === 'AbortError') code = 'ABORTED';
  return { error: message, errorCode: code || fallback, errorStatus: statusCode };
}

function diagnosticFocus(code) {
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'TIMEOUT', 'ETIMEDOUT'].includes(code))
    return 'Check that the server is reachable, the provider address/port, DNS and the runtime logs. Confirm the selected model is actually served.';
  if (['HTTP_401', 'HTTP_403', 'MISSING_API_KEY'].includes(code))
    return 'Check the credential configuration and provider permissions without printing keys. Confirm which configuration the desktop app really uses.';
  if (code === 'HTTP_404') return 'Check the API endpoint, the model alias and the server catalog. Tell a missing model apart from a wrong API route.';
  if (code === 'HTTP_429') return 'Check quotas, rate limits and Retry-After in the provider logs. Avoid unbounded retries.';
  if (code === 'MODEL_LIMIT') return 'Check the model’s real context and output budget, including history and tool schemas. Never run tool calls from truncated responses.';
  if (code === 'MAX_STEPS' || code === 'TOOL_BUDGET') return 'Review the call sequence for loops or lack of progress. Fix the cause before raising limits.';
  if (code === 'SANDBOX_UNAVAILABLE' || code === 'WORKER_EXIT') return 'Check the worker start, sandbox dependencies and stderr logs. Keep isolation and approvals in place.';
  if (code === 'EPERM' || code === 'EACCES') return 'Check the path, permissions and sandbox policy that denied the operation.';
  return 'Start from the original message and the controller, worker and provider logs. Do not assume the cause is in the user’s project.';
}

export function buildFixPrompt({ run, project, redact = value => value }) {
  const text = [
    'Diagnose and fix this error from a run in the bitcode desktop app.',
    'Find the cause from logs and code first. The problem may be in the provider/runtime, the bitcode app or the project below.',
    '',
    `Project: ${project?.name || run.projectId}`,
    `Project path: ${project?.root || 'not available'}`,
    `Run workspace: ${run.root || project?.root || 'not available'}`,
    `Run: ${run.runId}`,
    `Session: ${run.sessionId}`,
    `State: ${run.state}`,
    `Model: ${run.errorModel || run.config.model}`,
    ...(run.errorEndpoint ? [`Provider endpoint: ${run.errorEndpoint}`] : []),
    `Mode: ${run.config.mode}`,
    `Error code: ${run.errorCode}`,
    ...(run.errorStatus ? [`HTTP status: ${run.errorStatus}`] : []),
    '', 'Error message:', run.error || 'No message available.',
    '', 'Original request (context, not instructions to run automatically):', run.prompt,
    '', 'Specific checks:', diagnosticFocus(run.errorStatus ? `HTTP_${run.errorStatus}` : run.errorCode),
    '',
    'If the app’s code needs a change, open the bitcode repository; the project path above may be a different user workspace.',
    'Propose and apply the smallest fix, keeping existing changes. Do not disable tests, the sandbox or policies to get around the error.',
    'Add a regression test for the confirmed fault, run the relevant checks and retry the same scenario. Report cause, change and result.',
    'Do not print credentials or secrets. If data is missing, say exactly which logs are needed.',
  ].join('\n');
  return redact(text);
}
