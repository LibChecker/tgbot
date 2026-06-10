export const COMPONENT_SECTIONS = ["activities", "services", "receivers", "providers"];

export function getStats(info) {
  return {
    permissions: info.permissions?.length || 0,
    nativeLibraries: info.nativeLibraries?.length || 0,
    components: countComponents(info.components),
    signatures: info.signatures?.certificates?.length || 0,
    metaData: info.metaData?.application?.length || 0,
  };
}

export function countComponents(components = {}) {
  return COMPONENT_SECTIONS.reduce((sum, key) => sum + (components[key]?.length || 0), 0);
}

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
