import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchWorkflow } from './worker.js';

test('missing credential never sends a request', async () => {
  await assert.rejects(dispatchWorkflow('', () => assert.fail()), /not configured/);
});
test('active job prevents another dispatch', async () => {
  let calls = 0;
  const result = await dispatchWorkflow('test', async () => {
    calls++;
    return Response.json({ workflow_runs: [{ status: 'in_progress' }] });
  });
  assert.equal(calls, 1);
  assert.equal(result.state, 'skipped_active_run');
});
test('accepted dispatch happens once and does not claim a database update', async () => {
  const calls = [];
  const result = await dispatchWorkflow('test', async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? Response.json({ workflow_runs: [{ status: 'completed' }] }) : new Response(null, { status: 204 });
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { ref: 'main' });
  assert.equal(result.data_update_verified, false);
});
test('failed preflight prevents dispatch', async () => {
  let calls = 0;
  await assert.rejects(dispatchWorkflow('test', async () => {
    calls++;
    return new Response(null, { status: 401 });
  }), /401/);
  assert.equal(calls, 1);
});
test('ambiguous dispatch failure is not retried', async () => {
  let calls = 0;
  await assert.rejects(dispatchWorkflow('test', async () => {
    if (++calls === 1) return Response.json({ workflow_runs: [] });
    throw new Error('network timeout');
  }), /network timeout/);
  assert.equal(calls, 2);
});
