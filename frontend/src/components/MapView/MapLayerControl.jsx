import './MapLayerControl.css'

const LAYERS = [
  { key: 'metro', label: 'Metro', icon: '🚇', color: '#2563EB' },
  { key: 'mmts',  label: 'MMTS',  icon: '🚆', color: '#8B4513' },
]

export function MapLayerControl({ layers, onChange }) {
  return (
    <div className="map-layer-control" role="group" aria-label="Toggle map layers">
      <span className="map-layer-control__title">Layers</span>
      {LAYERS.map(({ key, label, icon, color }) => {
        const active = layers[key]
        return (
          <button
            key={key}
            className={`map-layer-btn${active ? ' --on' : ''}`}
            style={active ? { borderColor: color, color, background: `${color}18` } : {}}
            onClick={() => onChange({ ...layers, [key]: !active })}
            aria-pressed={active}
            aria-label={`${active ? 'Hide' : 'Show'} ${label} network on map`}
            title={`${active ? 'Hide' : 'Show'} ${label} network`}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
