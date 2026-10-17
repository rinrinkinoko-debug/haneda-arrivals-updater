const OWNER = 'rinrinkinoko-debug';
const REPO = 'haneda-arrivals-updater';
const WORKFLOW = 'update-arrivals.yml';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`;
const FRESH_MS = 8 * 60 * 1000;
const HARD_TIMEOUT_MS = 60 * 1000;
const token = process.env.GITHUB_TOKEN;

setTimeout(() => {
  console.error(JSON.stringify({ state: 'hard_timeout', timeout_ms: HARD_TIMEOUT_MS }));
  process.exit(1);
}, HARD_TIMEOUT_MS).unref();

if (!token) {
  console.log(JSON.stringify({ state: 'configuration_pending', missing: 'GITHUB_TOKEN' }));
  process.exit(0);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'haneda-arrivals-render-dispatcher',
};

async function request(url, options = {}) {
  return fetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(15000) });
}

const checkedAt = Date.now();
const runsResponse = await request(`${API}/runs?branch=main&per_page=10`);
if (!runsResponse.ok) throw new Error(`GitHub run check failed (${runsResponse.status})`);
const payload = await runsResponse.json();
if (!Array.isArray(payload.workflow_runs)) throw new Error('Invalid GitHub run response');

if (payload.workflow_runs.some(run => run.status !== 'completed')) {
  console.log(JSON.stringify({ state: 'skipped_active_run' }));
  process.exit(0);
}

const latestSuccess = payload.workflow_runs
  .filter(run => run.conclusion === 'success')
  .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];

if (latestSuccess && checkedAt - Date.parse(latestSuccess.updated_at) < FRESH_MS) {
  console.log(JSON.stringify({ state: 'skipped_fresh', latest_run_id: latestSuccess.id, latest_success_at: latestSuccess.updated_at }));
  process.exit(0);
}

// Do not retry this POST: a timed-out response can still mean GitHub accepted it.
const dispatchResponse = await request(`${API}/dispatches`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ref: 'main' }),
});
if (dispatchResponse.status !== 204) throw new Error(`GitHub workflow dispatch failed (${dispatchResponse.status})`);

for (let attempt = 1; attempt <= 6; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  const verifyResponse = await request(`${API}/runs?branch=main&event=workflow_dispatch&per_page=5`);
  if (!verifyResponse.ok) continue;
  const verifyPayload = await verifyResponse.json();
  const run = verifyPayload.workflow_runs?.find(item => Date.parse(item.created_at) >= checkedAt - 5000);
  if (run) {
    console.log(JSON.stringify({ state: 'dispatch_verified', run_id: run.id, status: run.status, created_at: run.created_at, data_update_verified: false }));
    process.exit(0);
  }
}

throw new Error('GitHub accepted the dispatch but the workflow run was not observed within 30 seconds');
