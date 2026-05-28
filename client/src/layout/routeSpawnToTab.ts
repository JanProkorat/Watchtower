import type { TabId } from '../../../shared/layout.js';
import { cwdTabId, projectTabId } from './tabId.js';

interface ProjectLike {
  id: number;
  folderPath: string | null;
}

export function routeSpawnToTab(cwd: string, projects: ProjectLike[]): TabId {
  for (const p of projects) {
    if (p.folderPath && p.folderPath === cwd) return projectTabId(p.id);
  }
  return cwdTabId(cwd);
}
