const BASE = 'https://api.github.com/repos/rinrinkinoko-debug/haneda-arrivals-updater/actions/workflows/update-arrivals.yml';

export async function dispatchWorkflow(token, request = fetch) {
  if (!token) throw new Error('GITHUB_TOKEN secret is not configured');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'haneda-arrivals-cloudflare-dispatcher',
  };
  const runsResponse = await request(`${BASE}/runs?branch=main&per_page=10`, {
    headers, signal: AbortSignal.timeout(15000),
  });
  if (!runsResponse.ok) throw new Error(`GitHub run check failed (${runsResponse.status})`);
  const { workflow_runs: runs } = await runsResponse.json();
  if (!Array.isArray(runs)) throw new Error('Invalid GitHub run response');
  if (runs.some(run => run.status !== 'completed')) return { state: 'skipped_active_run' };
  // Do not retry an ambiguous POST: GitHub may already have accepted it.
  const response = await request(`${BASE}/dispatches`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }), signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 204) throw new Error(`GitHub workflow dispatch failed (${response.status})`);
  return { state: 'dispatch_accepted', data_update_verified: false };
}

export default {
  async scheduled(controller, env) {
    const result = await dispatchWorkflow(env.GITHUB_TOKEN);
    console.log(JSON.stringify({ scheduled_at: controller.scheduledTime, ...result }));
  },
  async fetch() {
    return Response.json({ service: 'haneda-arrivals-dispatcher', data_update_verified: false });
  },
};
