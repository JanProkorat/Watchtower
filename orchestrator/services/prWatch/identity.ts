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

/**
 * The collection/org root for an ADO repo's `apiBase`. A git remote's apiBase is
 * `{collection}/{project}` (everything before `/_git/`, e.g.
 * `…/projects/SkodaAuto/SPOT` or `dev.azure.com/org/project`), but
 * `connectionData` is a *collection*-scoped resource — so strip the trailing
 * project segment. The segment right before `/_git/` is always the project, so
 * dropping the last path segment reliably yields the collection/org root on both
 * cloud and on-prem Azure DevOps.
 */
export function azdoOrgBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, '').replace(/\/[^/]+$/, '');
}

export async function resolveAzdoUser(
  apiBase: string,
  pat: string,
  get: HttpGet = defaultGet,
): Promise<{ id: string; displayName: string }> {
  // connectionData lives at the collection/org root (project scope 404s), and
  // on-prem Azure DevOps Server serves it as a *preview* resource — a plain
  // `api-version=7.1` returns 400 "under preview". Hit the org root with the
  // `-preview` flag so both cloud and on-prem resolve identity.
  const url = `${azdoOrgBase(apiBase)}/_apis/connectionData?api-version=7.1-preview`;
  const data = (await get(url, pat)) as { authenticatedUser?: { id?: string; providerDisplayName?: string } };
  const u = data.authenticatedUser;
  if (!u?.id) throw new Error('Could not resolve Azure DevOps user');
  return { id: u.id, displayName: u.providerDisplayName ?? '' };
}
