import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { LeafView } from './LeafView.js';
import { SplitDropZones } from './SplitDropZones.js';
import type { TabRecord, WorkspaceNode } from '../../../../shared/layout.js';
import type { InstanceView } from '../../state/useInstances.js';

interface Props {
  node: WorkspaceNode;
  tabs: TabRecord[];
  focusedLeafId: string | null;
  instances: InstanceView[];
  dragInProgress: boolean;
  onFocusColumn(tabId: string, instanceId: string): void;
  onFocusLeaf(leafId: string): void;
  onResizeSplit(splitId: string, sizes: number[]): void;
  onCloseColumn(instanceId: string): void;
  onHideSession(instanceId: string): void;
  onUnhideSession(instanceId: string): void;
  onAddSession(tabId: string): void;
  dashboardOnOpen?(id: string): void;
  dashboardOnKill?(id: string): void;
  dashboardOnRemove?(id: string): void;
  dashboardOnNew?(): void;
}

export function WorkspaceNodeView(props: Props) {
  const { node, tabs, focusedLeafId, instances, onFocusColumn, onFocusLeaf, onResizeSplit } =
    props;

  if (node.kind === 'leaf') {
    const tab = tabs.find((t) => t.id === node.tabId);
    if (!tab) return null;
    return (
      <Box
        onMouseDown={() => onFocusLeaf(node.id)}
        sx={{
          flex: 1,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        <LeafView
          tab={tab}
          focused={focusedLeafId === node.id}
          instances={instances}
          onFocusColumn={(instanceId) => onFocusColumn(tab.id, instanceId)}
          onCloseColumn={props.onCloseColumn}
          onHideSession={props.onHideSession}
          onUnhideSession={props.onUnhideSession}
          onAddSession={() => props.onAddSession(tab.id)}
          dashboardOnOpen={props.dashboardOnOpen}
          dashboardOnKill={props.dashboardOnKill}
          dashboardOnRemove={props.dashboardOnRemove}
          dashboardOnNew={props.dashboardOnNew}
        />
        <SplitDropZones leafId={node.id} visible={props.dragInProgress} />
      </Box>
    );
  }

  return (
    <PanelGroup
      direction={node.dir === 'row' ? 'horizontal' : 'vertical'}
      onLayout={(sizes) => onResizeSplit(node.id, sizes)}
    >
      {node.children.map((child, i) => (
        <PanelGroupSlot
          key={child.id}
          isLast={i === node.children.length - 1}
          defaultSize={node.sizes[i] ?? 100 / node.children.length}
          dir={node.dir}
        >
          <WorkspaceNodeView {...props} node={child} />
        </PanelGroupSlot>
      ))}
    </PanelGroup>
  );
}

function PanelGroupSlot({
  isLast,
  defaultSize,
  dir,
  children,
}: {
  isLast: boolean;
  defaultSize: number;
  dir: 'row' | 'col';
  children: ReactNode;
}) {
  return (
    <>
      <Panel defaultSize={defaultSize} minSize={10}>
        {children}
      </Panel>
      {!isLast &&
        (dir === 'row' ? (
          <PanelResizeHandle style={{ width: 4, background: 'rgba(255,255,255,0.08)' }} />
        ) : (
          <PanelResizeHandle style={{ height: 4, background: 'rgba(255,255,255,0.08)' }} />
        ))}
    </>
  );
}
