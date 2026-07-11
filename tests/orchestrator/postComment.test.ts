import { describe, it, expect } from 'vitest';
import { formatFindingBody, postGithubComment, postAzdoComment } from '../../orchestrator/services/prProviders/postComment.js';
import type { HttpPost } from '../../orchestrator/services/prProviders/postComment.js';
import type { PrFindingPayload } from '@watchtower/shared/ipcContract.js';
import type { Exec } from '../../orchestrator/services/prProviders/types.js';

const BASE: PrFindingPayload = {
  file: 'src/foo.ts',
  line: 42,
  severity: 'error',
  category: 'correctness',
  summary: 'off-by-one in loop bound',
};

describe('formatFindingBody', () => {
  it('renders the head line with severity/category/summary', () => {
    const body = formatFindingBody(BASE);
    expect(body).toContain('**[error] correctness** off-by-one in loop bound');
  });

  it('appends the detail paragraph when present', () => {
    const body = formatFindingBody({ ...BASE, detail: 'Loop iterates one past the array end.' });
    expect(body).toBe(
      '**[error] correctness** off-by-one in loop bound\n\nLoop iterates one past the array end.',
    );
  });

  it('omits any detail paragraph when absent', () => {
    const body = formatFindingBody(BASE);
    expect(body).toBe('**[error] correctness** off-by-one in loop bound');
    expect(body).not.toContain('\n\n');
  });
});

describe('postGithubComment', () => {
  it('calls gh api with the correct method/path/body/fields', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec: Exec = async (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    await postGithubComment('acme/repo', 17, 'abc123sha', BASE, exec);

    expect(calls).toHaveLength(1);
    const { cmd, args } = calls[0]!;
    expect(cmd).toBe('gh');
    expect(args[0]).toBe('api');
    expect(args).toContain('--method');
    expect(args[args.indexOf('--method') + 1]).toBe('POST');
    expect(args).toContain('repos/acme/repo/pulls/17/comments');
    expect(args).toContain(`body=${formatFindingBody(BASE)}`);
    expect(args).toContain('commit_id=abc123sha');
    expect(args).toContain(`path=${BASE.file}`);
    expect(args).toContain('side=RIGHT');
    // line is passed via -F (typed, not -f string) with the numeric value
    const lineFlagIdx = args.indexOf('-F');
    expect(lineFlagIdx).toBeGreaterThan(-1);
    expect(args[lineFlagIdx + 1]).toBe(`line=${BASE.line}`);
  });
});

describe('postAzdoComment', () => {
  it('posts to the threads endpoint with the right body shape', async () => {
    const calls: Array<{ url: string; pat: string; body: unknown }> = [];
    const post: HttpPost = async (url, pat, body) => {
      calls.push({ url, pat, body });
    };

    await postAzdoComment('https://devops.example.com/org/proj', 'myrepo', 42, BASE, 'my-pat', post);

    expect(calls).toHaveLength(1);
    const { url, pat, body } = calls[0]!;
    expect(url).toBe('https://devops.example.com/org/proj/_apis/git/repositories/myrepo/pullRequests/42/threads?api-version=7.1');
    expect(pat).toBe('my-pat');
    const b = body as {
      comments: Array<{ parentCommentId: number; content: string; commentType: number }>;
      status: number;
      threadContext: { filePath: string; rightFileStart: { line: number; offset: number }; rightFileEnd: { line: number; offset: number } };
    };
    expect(b.comments).toHaveLength(1);
    expect(b.comments[0]!.parentCommentId).toBe(0);
    expect(b.comments[0]!.content).toBe(formatFindingBody(BASE));
    expect(b.comments[0]!.commentType).toBe(1);
    expect(b.status).toBe(1);
    expect(b.threadContext.filePath).toBe('/src/foo.ts');
    expect(b.threadContext.rightFileStart).toEqual({ line: BASE.line, offset: 1 });
    expect(b.threadContext.rightFileEnd).toEqual({ line: BASE.line, offset: 1 });
  });

  it('does not double up a leading slash when finding.file already has one', async () => {
    const calls: Array<{ url: string; pat: string; body: unknown }> = [];
    const post: HttpPost = async (url, pat, body) => {
      calls.push({ url, pat, body });
    };
    const finding: PrFindingPayload = { ...BASE, file: '/already/leading.ts' };

    await postAzdoComment('https://devops.example.com/org/proj', 'myrepo', 42, finding, 'my-pat', post);

    const body = calls[0]!.body as { threadContext: { filePath: string } };
    expect(body.threadContext.filePath).toBe('/already/leading.ts');
  });
});
