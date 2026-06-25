export interface PushDeps {
  requestPermission(): Promise<boolean>;
  register(): Promise<void>;
  onToken(cb: (token: string) => void): void;
  sendToken(token: string): Promise<void>;
}

export async function registerForPush(deps: PushDeps): Promise<void> {
  deps.onToken((t) => { void deps.sendToken(t); });
  const granted = await deps.requestPermission();
  if (!granted) return;
  await deps.register();
}
