import { detectTerminalSystemFromNavigator, normalizeSystemPlatform } from "@shared/terminal-system.js";

export async function detectTerminalSystem() {
  const navigatorValue = window.navigator || {};
  const userAgentData = navigatorValue.userAgentData;

  if (userAgentData && typeof userAgentData.getHighEntropyValues === "function") {
    try {
      const values = await userAgentData.getHighEntropyValues(["platform", "platformVersion"]);
      const system = normalizeSystemPlatform(
        values.platform || userAgentData.platform || navigatorValue.platform,
        values.platformVersion,
      );

      if (system.name || system.version) {
        return {
          ...system,
          source: "userAgentData",
        };
      }
    } catch {
      // Fall back to the reduced user agent string.
    }
  }

  return detectTerminalSystemFromNavigator(navigatorValue);
}
