import { describe, it, expect } from 'vitest';
import { resolveGithubLogin, resolveAzdoUser, azdoOrgBase } from '../../orchestrator/services/prWatch/identity.js';

describe('identity', () => {
  it('resolveGithubLogin parses gh api user JSON', async () => {
    const exec = async () => 'jan';
    expect(await resolveGithubLogin(exec)).toBe('jan');
  });

  it('resolveAzdoUser parses connectionData', async () => {
    const get = async () => ({ authenticatedUser: { id: 'guid-1', providerDisplayName: 'Jan P' } });
    expect(await resolveAzdoUser('https://devops.example/org', 'pat', get)).toEqual({ id: 'guid-1', displayName: 'Jan P' });
  });

  // An ADO git remote's apiBase is `{collection}/{project}` (everything before
  // /_git/). connectionData is a COLLECTION-scoped resource, so identity must be
  // resolved against the org root — the project segment stripped off.
  it('azdoOrgBase strips the trailing project segment', () => {
    expect(azdoOrgBase('https://devops.skoda.vwgroup.com/projects/SkodaAuto/SPOT'))
      .toBe('https://devops.skoda.vwgroup.com/projects/SkodaAuto');
    expect(azdoOrgBase('https://dev.azure.com/org/project')).toBe('https://dev.azure.com/org');
    expect(azdoOrgBase('https://tfs/tfs/DefaultCollection/proj')).toBe('https://tfs/tfs/DefaultCollection');
  });

  // Regression: on the on-prem Skoda server, calling connectionData at *project*
  // scope 404s and api-version=7.1 (non-preview) returns 400 "under preview".
  // resolveAzdoUser must hit the org root with the -preview flag.
  it('resolveAzdoUser resolves connectionData at the org root with the -preview api-version', async () => {
    const calls: string[] = [];
    const get = async (url: string) => {
      calls.push(url);
      return { authenticatedUser: { id: 'guid-1', providerDisplayName: 'Jan P' } };
    };
    const user = await resolveAzdoUser('https://devops.skoda.vwgroup.com/projects/SkodaAuto/SPOT', 'pat', get);
    expect(user).toEqual({ id: 'guid-1', displayName: 'Jan P' });
    expect(calls[0]).toBe(
      'https://devops.skoda.vwgroup.com/projects/SkodaAuto/_apis/connectionData?api-version=7.1-preview',
    );
  });
});
