import { useInstances } from './useInstances.js';
import { useProjects } from './useProjects.js';
import { buildAttentionList, type AttentionItem } from './attentionList.js';

export function useAttentionInstances(): AttentionItem[] {
  const { instances } = useInstances();
  const { projects } = useProjects();
  return buildAttentionList(instances, projects);
}
