// Presentational mapping for the Reviews Azure DevOps PAT field. Kept free of
// MUI/React so it can be unit-tested in the node test env and so the three
// states are documented in one place.
export type PatFieldStatus = 'none' | 'saved' | 'unreadable';

export interface PatFieldView {
  chip: { label: string; color: 'success' | 'warning' } | null;
  placeholder: string;
}

export function patFieldView(status: PatFieldStatus): PatFieldView {
  switch (status) {
    case 'saved':
      return { chip: { label: 'saved', color: 'success' }, placeholder: '•••••• (saved, leave unchanged)' };
    case 'unreadable':
      // The stored PAT can't be decrypted — almost always because the app was
      // rebuilt/updated and the OS keychain key rotated. Prompt to re-enter.
      return {
        chip: { label: 'unreadable — re-enter', color: 'warning' },
        placeholder: 'saved PAT unreadable after update — re-enter it',
      };
    default:
      return { chip: null, placeholder: 'enter PAT' };
  }
}
