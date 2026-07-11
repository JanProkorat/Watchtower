export async function readPgPushTokens(
  pg: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> } | null,
): Promise<string[]> {
  if (!pg) return [];
  const { rows } = await pg.query(`SELECT apns_token FROM push_devices`);
  return rows.map(r => r.apns_token as string);
}
