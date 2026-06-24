export interface GroupableInstance { id: string; cwd: string; status: string }
export interface GroupableProject { id: number; name: string; folderPath: string | null }
export interface ProjectGroup {
  projectId: number | null;
  label: string;
  folderPath: string | null;
  instanceIds: string[];
}

/**
 * Lean project→instance grouping for the iPad tab strip. Matches each
 * instance's cwd to a project's folderPath; unmatched instances collect into a
 * trailing "Other" group. Empty project groups are omitted. Projects keep input
 * order; Other is always last. (The desktop's deriveTabs is intentionally NOT
 * reused — it carries split-pane / hidden / ad-hoc concerns the iPad lacks.)
 */
export function groupInstancesByProject(
  instances: ReadonlyArray<GroupableInstance>,
  projects: ReadonlyArray<GroupableProject>,
): ProjectGroup[] {
  const byProject = new Map<number, string[]>();
  const other: string[] = [];
  for (const inst of instances) {
    const proj = projects.find((p) => p.folderPath && p.folderPath === inst.cwd);
    if (proj) {
      const arr = byProject.get(proj.id) ?? [];
      arr.push(inst.id);
      byProject.set(proj.id, arr);
    } else {
      other.push(inst.id);
    }
  }
  const groups: ProjectGroup[] = [];
  for (const p of projects) {
    const ids = byProject.get(p.id);
    if (ids && ids.length) groups.push({ projectId: p.id, label: p.name, folderPath: p.folderPath, instanceIds: ids });
  }
  if (other.length) groups.push({ projectId: null, label: 'Other', folderPath: null, instanceIds: other });
  return groups;
}
