export function readWsConfig(
  loc: { search: string },
  storage: Pick<Storage, 'getItem'>,
): { url: string; token: string } | null {
  const params = new URLSearchParams(loc.search);
  const url = (params.get('wsUrl') || null) ?? storage.getItem('watchtower.wsUrl');
  const token = (params.get('wsToken') || null) ?? storage.getItem('watchtower.wsToken');
  if (url && token) return { url, token };
  return null;
}
