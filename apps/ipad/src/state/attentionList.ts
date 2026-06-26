import { ACTION_NEEDED_STATUSES } from '@watchtower/shared/tabAttention.js';
import type { InstanceView } from './useInstances.js';
import type { ProjectSummary } from './useProjects.js';

export interface AttentionItem { instanceId: string; label: string; reason: string }

const REASON: Record<string, string> = {
  'waiting-permission': 'čeká na povolení',
  'waiting-input': 'dokončeno, čeká na vstup',
  'crashed': 'spadlo',
};

export function buildAttentionList(instances: InstanceView[], projects: ProjectSummary[]): AttentionItem[] {
  return instances
    .filter((i) => ACTION_NEEDED_STATUSES.has(i.status))
    .map((i) => {
      const label = projects.find((p) => p.folderPath === i.cwd)?.name
        ?? i.cwd.split('/').filter(Boolean).pop() ?? i.id;
      return { instanceId: i.id, label, reason: REASON[i.status] ?? 'vyžaduje pozornost' };
    });
}
