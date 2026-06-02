// Light-theme mode metadata
export const MODE_META = {
  metro: { color: '#2563eb', bg: '#dbeafe', label: 'Metro', icon: 'M' },
  mmts:  { color: '#d97706', bg: '#fef3c7', label: 'MMTS',  icon: 'T' },
  bus:   { color: '#ea580c', bg: '#ffedd5', label: 'Bus',   icon: 'B' },
  walk:  { color: '#64748b', bg: '#f1f5f9', label: 'Walk',  icon: '🚶' },
  auto:  { color: '#ca8a04', bg: '#fefce8', label: 'Auto',  icon: 'A' },
}

export function getMeta(mode) {
  return MODE_META[mode] ?? { color: '#64748b', bg: '#f1f5f9', label: mode, icon: '?' }
}
