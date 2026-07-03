import { homedir } from 'node:os';
import path from 'node:path';
import type { SqliteLike } from '../db/migrations.js';
import type { InstanceRow } from '@watchtower/shared/stateModel.js';
import { ProjectsRepo } from '../db/repositories/projects.js';
import { EpicsRepo } from '../db/repositories/epics.js';
import { TasksRepo } from '../db/repositories/tasks.js';
import { WorklogsRepo } from '../db/repositories/worklogs.js';
import { HookEventsRepo } from '../db/repositories/hookEvents.js';

/** Gaps between consecutive activity pings longer than this count as idle. */
export const IDLE_CAP_MS = 10 * 60 * 1000;

/** Local YYYY-MM-DD for an epoch-ms timestamp. */
export function localDateStr(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Capped-gap active minutes grouped by local work date. For each consecutive
 * pair of pings the elapsed time (capped at idleCapMs) is credited to the
 * local date of the EARLIER ping. A lone ping has no measurable duration → 0.
 * A gap that straddles midnight is credited whole to the earlier day; since
 * gaps are capped at idleCapMs (10 min) the misattribution is bounded and
 * accepted (see the design's edge-cases section).
 */
export function activeMinutesByDate(
  pings: number[],
  idleCapMs: number,
): Map<string, number> {
  const sorted = [...pings].sort((a, b) => a - b);
  const msByDate = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.min(sorted[i]! - sorted[i - 1]!, idleCapMs);
    if (gap <= 0) continue;
    const date = localDateStr(sorted[i - 1]!);
    msByDate.set(date, (msByDate.get(date) ?? 0) + gap);
  }
  const minutesByDate = new Map<string, number>();
  for (const [date, ms] of msByDate) {
    minutesByDate.set(date, Math.round(ms / 60000));
  }
  return minutesByDate;
}

const AUTO_SOURCE = 'watchtower-auto';
const AUTO_EPIC_NAME = 'Auto-tracked';
const AUTO_TASK_NUMBER = 'AUTO';
const AUTO_TASK_TITLE = 'General';

/** Expand a leading `~` in a stored folder_path to the user's home dir. */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

/**
 * Turns a managed instance's SessionEnd into a worklog against its project.
 * Best-effort: any failure is swallowed so it can never break the hook path.
 */
export class AutoTimeLogger {
  private projects: ProjectsRepo;
  private epics: EpicsRepo;
  private tasks: TasksRepo;
  private worklogs: WorklogsRepo;
  private hookEvents: HookEventsRepo;

  constructor(
    db: SqliteLike,
    private onChange?: () => void,
  ) {
    // Construct repos in the body (not as field initializers) so `db` is
    // already bound — parameter properties assign after field initializers.
    this.projects = new ProjectsRepo(db);
    this.epics = new EpicsRepo(db);
    this.tasks = new TasksRepo(db);
    this.worklogs = new WorklogsRepo(db);
    this.hookEvents = new HookEventsRepo(db);
  }

  onSessionEnd(instance: InstanceRow): void {
    try {
      this.run(instance);
    } catch {
      /* auto-logging is best-effort — never propagate into the hook path */
    }
  }

  private run(instance: InstanceRow): void {
    const project = this.projects
      .list({ archived: false })
      .find((p) => p.folderPath != null && expandHome(p.folderPath) === instance.cwd);
    if (!project || !project.autoTrack) return;

    const taskId = this.resolveTask(instance.taskId, project.id);
    const pings = this.hookEvents.listForInstance(instance.id).map((e) => e.receivedAt);
    const minutesByDate = activeMinutesByDate(pings, IDLE_CAP_MS);

    let wrote = false;
    for (const [workDate, minutes] of minutesByDate) {
      if (minutes < 1) continue;
      const externalId = `auto:${instance.id}:${workDate}`;
      try {
        const existing = this.worklogs.findByExternalId(AUTO_SOURCE, externalId);
        if (existing) {
          if (existing.minutes !== minutes || existing.taskId !== taskId) {
            this.worklogs.update(existing.id, { minutes, taskId });
            wrote = true;
          }
        } else {
          this.worklogs.create({
            taskId,
            workDate,
            minutes,
            reportedMinutes: null,
            source: AUTO_SOURCE,
            externalId,
            description: 'Auto-tracked',
          });
          wrote = true;
        }
      } catch {
        /* locked billing window or done-task race — skip this date */
      }
    }
    if (wrote) this.onChange?.();
  }

  /** The instance's tagged task if it exists and isn't done, else the catch-all. */
  private resolveTask(taggedTaskId: number | null, projectId: number): number {
    if (taggedTaskId != null) {
      const t = this.tasks.get(taggedTaskId);
      if (t && t.status !== 'done') return t.id;
    }
    return this.catchAllTaskId(projectId);
  }

  /** Find-or-create the project's "Auto-tracked" epic → "AUTO" task. */
  private catchAllTaskId(projectId: number): number {
    const epic =
      this.epics.listForProject(projectId).find((e) => e.name === AUTO_EPIC_NAME) ??
      this.epics.create({ projectId, name: AUTO_EPIC_NAME, status: 'active' });
    const task =
      this.tasks.listForEpic(epic.id).find((t) => t.number === AUTO_TASK_NUMBER) ??
      this.tasks.create({ epicId: epic.id, number: AUTO_TASK_NUMBER, title: AUTO_TASK_TITLE });
    return task.id;
  }
}
