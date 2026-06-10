/** @typedef {import("@shared/contracts.js").ApkComponentGroups} ApkComponentGroups */
/** @typedef {import("@shared/contracts.js").ApkInfo} ApkInfo */

export const COMPONENT_SECTIONS = ["activities", "services", "receivers", "providers"];

/** @param {Partial<ApkInfo>} info */
export function getStats(info) {
  return {
    permissions: info.permissions?.length || 0,
    nativeLibraries: info.nativeLibraries?.length || 0,
    components: countComponents(info.components),
    signatures: info.signatures?.certificates?.length || 0,
    metaData: info.metaData?.application?.length || 0,
  };
}

/** @param {Partial<ApkComponentGroups>} [components] */
export function countComponents(components = {}) {
  return COMPONENT_SECTIONS.reduce((sum, key) => sum + (components[key]?.length || 0), 0);
}

/**
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T) => string} getKey
 * @returns {Map<string, T[]>}
 */
export function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    const values = groups.get(key) || [];
    values.push(item);
    groups.set(key, values);
  }
  return groups;
}
