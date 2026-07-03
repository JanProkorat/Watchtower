// TimeTracker billing sub-routes. Owned here (a TimeTracker concept); the iPad
// Rail re-exports this so app-level nav code keeps importing it from the Rail.
export type BillingSection =
  | 'earnings' | 'reports'
  | 'records-list' | 'records-grid' | 'records-tasks' | 'records-timeoff'
  | 'board';
