declare module '@novnc/novnc/core/rfb.js' {
  interface RFBOptions { credentials?: { password?: string }; wsProtocols?: string[]; }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    scaleViewport: boolean;
    background: string;
    disconnect(): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    sendCtrlAltDel(): void;
  }
}
