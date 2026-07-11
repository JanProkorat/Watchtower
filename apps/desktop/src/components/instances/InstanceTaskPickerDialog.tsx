import { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import type { EpicViewPayload, ProjectViewPayload, TaskViewPayload } from '@watchtower/shared/ipcContract.js';

interface Props {
  open: boolean;
  /** The working directory of the instance — used to preselect the best matching project. */
  instanceCwd: string;
  /** Currently tagged task id, or null if none. */
  currentTaskId: number | null;
  onAssign(taskId: number): void;
  onClear(): void;
  onClose(): void;
}

function bestProjectId(
  projects: ProjectViewPayload[],
  cwd: string,
): number | null {
  // Expand leading ~ in folderPath to the same prefix as cwd (renderer doesn't
  // have homedir(), so we use the cwd's home prefix heuristically — if cwd
  // starts with /Users/... we match by stripping ~ from the folder path).
  let best: ProjectViewPayload | null = null;
  let bestLen = -1;
  for (const p of projects) {
    if (!p.folderPath) continue;
    // Normalise ~ in the stored folder path using the cwd as a reference.
    let folder = p.folderPath;
    if (folder.startsWith('~/') && cwd.startsWith('/')) {
      // Derive home from cwd: find the longest /Users/<user> or /home/<user> prefix.
      const homeMatch = cwd.match(/^(\/(?:Users|home)\/[^/]+)\//);
      if (homeMatch) folder = homeMatch[1] + folder.slice(1);
    }
    if (cwd.startsWith(folder) && folder.length > bestLen) {
      best = p;
      bestLen = folder.length;
    }
  }
  return best?.id ?? null;
}

export function InstanceTaskPickerDialog({
  open,
  instanceCwd,
  currentTaskId,
  onAssign,
  onClear,
  onClose,
}: Props) {
  const [projects, setProjects] = useState<ProjectViewPayload[]>([]);
  const [epics, setEpics] = useState<EpicViewPayload[]>([]);
  const [tasks, setTasks] = useState<TaskViewPayload[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedEpicId, setSelectedEpicId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  // Load all active projects when dialog opens.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await window.watchtower.invoke('projects:list', { archived: false });
        setProjects(res.projects);
        // Preselect by best folderPath match.
        const preselect = bestProjectId(res.projects, instanceCwd);
        setSelectedProjectId(preselect);
      } catch {
        setProjects([]);
      }
    })();
  }, [open, instanceCwd]);

  // Load epics + tasks whenever the selected project changes.
  useEffect(() => {
    setEpics([]);
    setTasks([]);
    setSelectedEpicId(null);
    setSelectedTaskId(null);
    if (selectedProjectId == null) return;
    void (async () => {
      try {
        const [epicsRes, tasksRes] = await Promise.all([
          window.watchtower.invoke('epics:list', { projectId: selectedProjectId }),
          window.watchtower.invoke('tasks:listForProject', { projectId: selectedProjectId }),
        ]);
        setEpics(epicsRes.epics);
        setTasks(tasksRes.tasks);
      } catch {
        setEpics([]);
        setTasks([]);
      }
    })();
  }, [selectedProjectId]);

  // Reset local state on close so re-opening starts fresh.
  useEffect(() => {
    if (!open) {
      setProjects([]);
      setEpics([]);
      setTasks([]);
      setSelectedProjectId(null);
      setSelectedEpicId(null);
      setSelectedTaskId(null);
    }
  }, [open]);

  const filteredTasks = useMemo(
    () => (selectedEpicId != null ? tasks.filter((t) => t.epicId === selectedEpicId) : tasks),
    [tasks, selectedEpicId],
  );

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedEpic = epics.find((e) => e.id === selectedEpicId) ?? null;
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const canAssign = selectedTaskId != null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign to task</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Autocomplete
            options={projects}
            getOptionLabel={(p) => p.name}
            value={selectedProject}
            onChange={(_, v) => {
              setSelectedProjectId(v?.id ?? null);
            }}
            renderInput={(params) => (
              <TextField {...params} label="Project" size="small" />
            )}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No projects"
          />
          <Autocomplete
            options={epics}
            getOptionLabel={(e) => e.name}
            value={selectedEpic}
            onChange={(_, v) => {
              setSelectedEpicId(v?.id ?? null);
              setSelectedTaskId(null);
            }}
            disabled={selectedProjectId == null}
            renderInput={(params) => (
              <TextField {...params} label="Epic (optional)" size="small" />
            )}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No epics"
          />
          <Autocomplete
            options={filteredTasks}
            getOptionLabel={(t) => `${t.number ? t.number + ' – ' : ''}${t.title}`}
            value={selectedTask}
            onChange={(_, v) => setSelectedTaskId(v?.id ?? null)}
            disabled={selectedProjectId == null}
            renderInput={(params) => (
              <TextField {...params} label="Task" size="small" />
            )}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            noOptionsText="No tasks"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {currentTaskId != null && (
          <Button
            color="warning"
            onClick={() => {
              onClear();
              onClose();
            }}
            sx={{ mr: 'auto' }}
          >
            Clear assignment
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!canAssign}
          onClick={() => {
            if (selectedTaskId != null) {
              onAssign(selectedTaskId);
              onClose();
            }
          }}
        >
          Assign
        </Button>
      </DialogActions>
    </Dialog>
  );
}
