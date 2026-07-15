declare const __APK_WEBUI_VERSION__: string;
declare const __BOT_REPORT_DATA_ORIGIN__: string;

interface Navigator {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
  deviceMemory?: number;
  getBattery?: () => Promise<{
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    charging: boolean;
    level: number;
  }>;
  modelContext?: {
    registerTool?: (...args: unknown[]) => unknown;
  };
  mozConnection?: Navigator["connection"];
  userAgentData?: {
    getHighEntropyValues?: (hints: string[]) => Promise<Record<string, string>>;
    mobile?: boolean;
    platform?: string;
  };
  webkitConnection?: Navigator["connection"];
}

interface Document {
  modelContext?: Navigator["modelContext"];
}

interface EventTarget {
  closest(selectors: string): HTMLElement | null;
}
