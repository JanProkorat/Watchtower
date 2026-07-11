# Reviews SP3 — post-back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** From a completed review, let the user select findings and post them as **inline comments on the PR** — GitHub review comments (via `gh`) and Azure DevOps threads (via REST + PAT), anchored to `file:line`. Plain text (no AI marker). Explicit confirmation before writing; graceful handling when a line isn't postable or the DevOps PAT is read-only.

**Architecture:** New provider `postComment` functions (github/azdo), an orchestrator `prReview:postComments` handler that posts each selected finding, marks posted findings in the stored `findings_json` (no migration — a `posted?: boolean` flag on each finding), and returns per-finding results. Renderer adds selection checkboxes + a confirm dialog + "Post N comments" button + posted indicators.

**Tech Stack:** `gh api` (POST), Azure DevOps REST (POST thread, Basic-auth PAT), React + MUI.

## Global Constraints
- **Writes to real PRs** (Škoda DevOps included): require an explicit confirm dialog; never post without it. Attribution: **plain** (no marker).
- Renderer → electron-main → orchestrator; renderer never posts directly. `prReview:postComments` is orchestrator-bound and **DevOps-bound** — electron-main injects `devopsPats` (same as `prs:refresh`/`prs:diff`/`prs:comments`).
- English UI; MUI + `sx`; theme tokens; no styled()/Table/Avatar.
- DevOps PAT may be **read-only** → a POST 403 must surface as a clear per-finding error, not a crash.
- No migration: posted state is a `posted?: boolean` on each finding, persisted by rewriting `findings_json`.
- Comment body (shared pure `formatFindingBody`): `**[${severity}] ${category}** ${summary}` + (detail ? `\n\n${detail}` : '').
- Tests: vitest node env, `.js` extensions, test exported pure functions + provider posters with injected IO seams.

## File structure
**Create:** `orchestrator/services/prProviders/postComment.ts` (`formatFindingBody`, `postGithubComment`, `postAzdoComment`).
**Modify:** `packages/shared/src/{ipcContract,messagePort}.ts` (kind + `posted?` field), `orchestrator/db/repositories/prReviews.ts` (`updateFindings`), `orchestrator/index.ts` (handler), `electron/ipc.ts` (PAT injection for the new kind), `apps/desktop/src/state/useReviews.ts` (`postComments`), `apps/desktop/src/components/reviews/{ReviewReport,FindingCard}.tsx` (checkboxes + confirm + Post button + posted chip).
**Test:** `tests/orchestrator/postComment.test.ts`.

---

## Task 1: Contract + comment-body + repo update

**Files:** Modify `packages/shared/src/{ipcContract,messagePort}.ts`, `orchestrator/db/repositories/prReviews.ts`; Create `orchestrator/services/prProviders/postComment.ts` (just `formatFindingBody` for now); Test `tests/orchestrator/postComment.test.ts`.

**Interfaces produced:**
- `PrFindingPayload` gains `posted?: boolean` (ipcContract).
- Request `prReview:postComments` `{ reviewId: number; findingIndexes: number[]; devopsPats?: Record<string,string> }` → `{ posted: number; skipped: number; errors: string[] }`. Mirror into messagePort.
- `PrReviewsRepo.updateFindings(id: number, findingsJson: string): void` (UPDATE findings_json WHERE id).
- `export function formatFindingBody(f: PrFindingPayload): string` (per Global Constraints).

- [ ] **Step 1:** Write failing test for `formatFindingBody` (with + without detail → assert the `**[sev] cat** summary` head and the detail paragraph).
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Add `posted?: boolean` to `PrFindingPayload`; add the `prReview:postComments` kind (req+resp) to ipcContract + mirror to messagePort; add `PrReviewsRepo.updateFindings`; create `postComment.ts` with `formatFindingBody`.
- [ ] **Step 4:** Run test green; `npx tsc -p orchestrator/tsconfig.json --noEmit` (a non-exhaustive-switch error for the new kind is expected until Task 3).
- [ ] **Step 5: Commit** `feat(reviews): post-back contract + comment body + findings update`.

---

## Task 2: Provider posters (GitHub + Azure DevOps)

**Files:** Modify `orchestrator/services/prProviders/postComment.ts`; Test `tests/orchestrator/postComment.test.ts`.

**Interfaces produced:**
```ts
import type { Exec } from './types.js';
export type HttpPost = (url: string, pat: string, body: unknown) => Promise<void>;
export function postGithubComment(nwo: string, prNumber: number, headSha: string, finding: PrFindingPayload, exec?: Exec): Promise<void>;
export function postAzdoComment(apiBase: string, repo: string, prNumber: number, finding: PrFindingPayload, pat: string, post?: HttpPost): Promise<void>;
```
- `postGithubComment`: `exec('gh', ['api','--method','POST',`repos/${nwo}/pulls/${prNumber}/comments`, '-f',`body=${formatFindingBody(finding)}`, '-f',`commit_id=${headSha}`, '-f',`path=${finding.file}`, '-F',`line=${finding.line}`, '-f','side=RIGHT'])`. (Args array → no shell injection. A 422 "line not in diff" surfaces as the exec error → caller catches per-finding.)
- `postAzdoComment`: `post(`${apiBase}/_apis/git/repositories/${repo}/pullRequests/${prNumber}/threads?api-version=7.1`, pat, { comments:[{ parentCommentId:0, content: formatFindingBody(finding), commentType:1 }], status:1, threadContext:{ filePath:'/'+finding.file.replace(/^\//,''), rightFileStart:{line:finding.line, offset:1}, rightFileEnd:{line:finding.line, offset:1} } })`. Default `post` = fetch POST with `Authorization: Basic base64(':'+pat)`, `Content-Type: application/json`; throw `Azure DevOps ${res.status}` on non-ok (403 = read-only PAT).

- [ ] **Step 1:** Write failing tests: `postGithubComment` with an injected `exec` that records argv → assert the `gh api --method POST … path=<file> line=<n> side=RIGHT` shape + body from `formatFindingBody`; `postAzdoComment` with an injected `post` that records (url, body) → assert the threads URL + `threadContext.filePath` (leading `/`) + rightFileStart.line + content.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement both (+ the default fetch-based `post`).
- [ ] **Step 4:** Run green.
- [ ] **Step 5: Commit** `feat(reviews): GitHub + Azure DevOps comment posters`.

---

## Task 3: Orchestrator handler + PAT injection

**Files:** Modify `orchestrator/index.ts`, `electron/ipc.ts`.

- `electron/ipc.ts`: add `'prReview:postComments'` to the DevOps-PAT injection branch (alongside `prs:refresh`/`prs:diff`/`prs:comments`).
- `orchestrator/index.ts` `case 'prReview:postComments'`:
  - Load the review row (`prReviewsRepo().get(reviewId)`); if missing → throw. Parse findings.
  - Resolve the repo via `reviewsSvc().resolveRepos()` (find by host+repoKey) to get github `nwo` / azdo `apiBase`+`repo`; get `headSha` from the row.
  - For each index in `findingIndexes` (skip out-of-range): try to post — github → `postGithubComment(nwo, prNumber, headSha, finding)`; azdo → `pat = devopsPats?.[repo.devopsHost]`; if no pat → push an error `'<file>:<line>: chybí PAT'` and continue; else `postAzdoComment(apiBase, repo, prNumber, finding, pat)`. On success mark `findings[i].posted = true` and `posted++`; on throw push `'<file>:<line>: ' + msg` to errors.
  - After the loop: `prReviewsRepo().updateFindings(reviewId, JSON.stringify(findings))`; emit a `prReviewDone` push (so the renderer reloads the review with posted flags). Return `{ posted, skipped, errors }`.
- [ ] **Step 1:** Implement the handler + electron injection. (Read the existing `prs:comments` injection + `resolveRepos`/`reviewPayloadOf` for shapes.)
- [ ] **Step 2:** `npm run typecheck:ci` clean (switch exhaustive). `npx vitest run` — only known EADDRINUSE failures.
- [ ] **Step 3: Commit** `feat(reviews): post-back orchestrator handler`.

---

## Task 4: Selection UI + confirm + Post button

**Files:** Modify `apps/desktop/src/components/reviews/{ReviewReport,FindingCard}.tsx`, `apps/desktop/src/state/useReviews.ts`.

- `useReviews`: add `postComments(reviewId, findingIndexes) => Promise<{posted:number;skipped:number;errors:string[]}>` (invoke `prReview:postComments`; the reload happens via the `prReviewDone` push already subscribed).
- `FindingCard`: accept optional `selected?: boolean`, `onToggle?: () => void`, and render a leading MUI `Checkbox` when `onToggle` is provided (disabled + a small "posted" `Chip color=success` when `finding.posted`).
- `ReviewReport` (done state): maintain a `Set<number>` of selected finding indexes (only selectable when not already `posted`); a footer bar with a **"Post N comments"** `Button` (disabled when 0 selected) that opens a **confirm MUI `Dialog`** ("Post N comments to this pull request? This writes to the PR." / Cancel / Post). On confirm → `postComments(review.id, [...selected])` → toast the result (`${posted} posted${skipped?`, ${skipped} skipped`:''}${errors.length?`, ${errors.length} failed`:''}`) via `useToast().showError` for failures / a success path; clear selection. Posted findings then show the "posted" chip (from the reloaded review) and can't be re-selected. English copy.
- [ ] **Step 1:** `useReviews.postComments` + FindingCard checkbox/posted-chip.
- [ ] **Step 2:** ReviewReport selection + confirm dialog + Post button + toast.
- [ ] **Step 3:** `npm run typecheck:ci` clean; `npx vitest run tests/client/` green.
- [ ] **Step 4: Commit** `feat(reviews): finding selection + confirm + post to PR`.

---

## Self-review (plan author)
- **Spec coverage (design §7 SP3):** host-aware posting (T2), selection UI (T4), `prReview:postComments` IPC (T1/T3). Inline per finding ✓; plain text ✓; confirm before write ✓ (T4); read-only-PAT + line-not-in-diff → per-finding errors (T3). Posted state persisted without a migration (T1 `posted?` + `updateFindings`).
- **Safety:** no post without the confirm dialog; PAT injected only for this DevOps-bound kind; errors surfaced per finding (no silent failure).
- **Type consistency:** `formatFindingBody`/`PrFindingPayload.posted` (T1) used in T2–T4; `postGithubComment`/`postAzdoComment` (T2) used in T3; `postComments` (T4) matches the T1 IPC shape.
