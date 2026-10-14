const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** URLs `openExternalUrl` may hand to the OS: any https, or http on this machine's loopback. */
export function isOpenableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname) && url.username === '' && url.password === '';
}
