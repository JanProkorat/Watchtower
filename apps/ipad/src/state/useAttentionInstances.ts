import { useInstancesData } from './instancesData.js';
import { buildAttentionList, type AttentionItem } from './attentionList.js';

export function useAttentionInstances(): AttentionItem[] {
  const { instances, projects } = useInstancesData();
  return buildAttentionList(instances, projects);
}
