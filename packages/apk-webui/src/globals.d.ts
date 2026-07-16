declare const __APK_WEBUI_VERSION__: string;
declare const __BOT_REPORT_DATA_ORIGIN__: string;

interface LaunchParams {
  files: FileSystemFileHandle[];
  targetURL?: string;
}

interface LaunchQueue {
  setConsumer(consumer: (launchParams: LaunchParams) => void | Promise<void>): void;
}

interface Window {
  launchQueue?: LaunchQueue;
}

declare var launchQueue: LaunchQueue | undefined;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}

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
  standalone?: boolean;
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
