export async function readPgPushTokens(
  pg: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> } | null,
): Promise<{ token: string; bundleId: string }[]> {
  if (!pg) return [];
  const { rows } = await pg.query(`SELECT apns_token, bundle_id FROM push_devices`);
  return rows.map(r => ({ token: r.apns_token as string, bundleId: r.bundle_id as string }));
}
