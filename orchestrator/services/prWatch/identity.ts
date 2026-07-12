import type { Exec, HttpGet } from '../prProviders/types.js';
import { defaultExec } from '../prProviders/exec.js';

const defaultGet: HttpGet = async (url, pat) => {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Azure DevOps ${res.status} for ${url}`);
  return res.json();
};

export async function resolveGithubLogin(exec: Exec = defaultExec): Promise<string> {
  const out = await exec('gh', ['api', 'user', '--jq', '.login']);
  const login = out.trim();
  if (login) return login;
  // Fallback: full JSON payload.
  const full = JSON.parse(await exec('gh', ['api', 'user'])) as { login?: string };
  if (!full.login) throw new Error('Could not resolve GitHub login');
  return full.login;
}

export async function resolveAzdoUser(
  apiBase: string,
  pat: string,
  get: HttpGet = defaultGet,
): Promise<{ id: string; displayName: string }> {
  // apiBase is org-level (e.g. https://host/org). connectionData sits at that scope.
  const url = `${apiBase}/_apis/connectionData?api-version=7.1`;
  const data = (await get(url, pat)) as { authenticatedUser?: { id?: string; providerDisplayName?: string } };
  const u = data.authenticatedUser;
  if (!u?.id) throw new Error('Could not resolve Azure DevOps user');
  return { id: u.id, displayName: u.providerDisplayName ?? '' };
}
