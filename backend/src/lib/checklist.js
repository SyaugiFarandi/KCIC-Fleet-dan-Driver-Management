export const TRIP_CHECKLIST_ITEMS = [
  { key: 'documents', label: 'STNK & SIM tersedia di kendaraan' },
  { key: 'tires', label: 'Kondisi ban dan tekanan angin' },
  { key: 'lights', label: 'Lampu, klakson, dan wiper berfungsi' },
  { key: 'fluids', label: 'Oli, bahan bakar, dan air radiator cukup' },
  { key: 'safety', label: 'Segitiga pengaman dan APAR tersedia' },
  { key: 'cleanliness', label: 'Kebersihan kabin dan kenyamanan penumpang' },
];

export const CHECKLIST_MAX_ITEMS = 20;

function slugKey(label, fallbackIndex) {
  const slug = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || `item-${fallbackIndex + 1}`;
}

/** Builds stable `{ key, label }` items from free-text labels for a vehicle template. */
export function normalizeChecklistItems(labels) {
  const seen = new Set();
  const items = [];
  labels.forEach((raw, index) => {
    const label = String(raw ?? '').trim();
    if (label.length < 3) return;
    let key = slugKey(label, index);
    while (seen.has(key)) key = `${key}-${index + 1}`;
    seen.add(key);
    items.push({ key, label: label.slice(0, 120) });
  });
  return items;
}

/** Per-vehicle checklist template with fallback to the default trip checklist. */
export function checklistItemsFor(vehicle) {
  const custom = vehicle?.checklistTemplate?.items;
  if (!Array.isArray(custom) || !custom.length) return TRIP_CHECKLIST_ITEMS;
  const items = custom.filter((item) => item && typeof item.key === 'string' && typeof item.label === 'string' && item.key && item.label);
  return items.length ? items : TRIP_CHECKLIST_ITEMS;
}
