import { useState } from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { ProjectViewPayload } from '@watchtower/shared/ipcContract.js';
import { useNotes } from '../../state/useNotes.js';
import { glassSurface } from '../../theme/glass.js';
import { NoteList } from './NoteList.js';
import { NoteEditor } from './NoteEditor.js';

const LIST_WIDTH = 308;

export function ModuleNotes({ projects }: { projects: ProjectViewPayload[] }): JSX.Element {
  const theme = useTheme();
  const { notes, filter, setFilter, create, update, remove } = useNotes();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const handleNew = () => {
    void create({
      done: null,
      projectId: filter.scope === 'project' ? filter.projectId : null,
    }).then((n) => setSelectedId(n.id));
  };

  const handleToggleDone = (id: number) => {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    void update(id, { done: n.done === 1 ? 0 : 1 });
  };

  const handleChange = (input: Parameters<typeof update>[1]) => {
    if (selectedId == null) return;
    void update(selectedId, input);
  };

  const handleDelete = () => {
    if (selectedId == null) return;
    void remove(selectedId);
    setSelectedId(null);
  };

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
      <Box
        sx={{
          width: LIST_WIDTH,
          flexShrink: 0,
          minHeight: 0,
          m: 1,
          mr: 0.5,
          borderRadius: 2,
          overflow: 'hidden',
          ...glassSurface(theme, { elevation: 1 }),
        }}
      >
        <NoteList
          notes={notes}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleDone={handleToggleDone}
          onNew={handleNew}
          filter={filter}
          setFilter={setFilter}
          projects={projects}
        />
      </Box>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          m: 1,
          ml: 0.5,
          borderRadius: 2,
          overflow: 'hidden',
          display: 'flex',
          ...glassSurface(theme, { elevation: 1 }),
        }}
      >
        <NoteEditor note={selected} projects={projects} onChange={handleChange} onDelete={handleDelete} />
      </Box>
    </Box>
  );
}
