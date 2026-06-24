import { useState } from 'react';

export function useActiveTerminal(): { activeId: string | null; setActiveId: (id: string | null) => void } {
  const [activeId, setActiveId] = useState<string | null>(null);
  return { activeId, setActiveId };
}
