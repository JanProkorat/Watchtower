// EarningsMonthView — stub; fleshed out in Task 10.
export function EarningsMonthView({ onOpenProject }: { onOpenProject: (projectId: number) => void }): JSX.Element {
  void onOpenProject; // prop reserved for Task 10 drill-down
  return <div style={{ padding: 20, color: '#8B88A6' }}>Výdělky (R1)</div>;
}
