const OWNER = "rinrinkinoko-debug";
const REPO = "haneda-arrivals-updater";
const WORKFLOW = "update-arrivals.yml";

async function dispatchWorkflow(token) {
  if (!token) {
    throw new Error("GITHUB_TOKEN secret is not configured");
  }

  const response = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "haneda-arrivals-cloudflare-dispatcher",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  if (response.status !== 204) {
    throw new Error(
      `GitHub workflow dispatch failed (${response.status}): ${await response.text()}`,
    );
  }
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchWorkflow(env.GITHUB_TOKEN));
  },

  async fetch() {
    return new Response("Haneda arrivals dispatcher is running.", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
