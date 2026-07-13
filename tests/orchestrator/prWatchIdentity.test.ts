import { describe, it, expect } from 'vitest';
import { resolveGithubLogin, resolveAzdoUser } from '../../orchestrator/services/prWatch/identity.js';

describe('identity', () => {
  it('resolveGithubLogin parses gh api user JSON', async () => {
    const exec = async () => 'jan';
    expect(await resolveGithubLogin(exec)).toBe('jan');
  });

  it('resolveAzdoUser parses connectionData', async () => {
    const get = async () => ({ authenticatedUser: { id: 'guid-1', providerDisplayName: 'Jan P' } });
    expect(await resolveAzdoUser('https://devops.example/org', 'pat', get)).toEqual({ id: 'guid-1', displayName: 'Jan P' });
  });
});
