import './MapLayerControl.css'

const BASE_TILES = [
  { key: 'standard',  label: 'Standard',  icon: '🗺️' },
  { key: 'satellite', label: 'Satellite', icon: '🛰️' },
  { key: 'transit',   label: 'Transit',   icon: '🚌' },
]

const OVERLAYS = [
  { key: 'metro', label: 'Metro', icon: '🚇', color: '#2563EB' },
  { key: 'mmts',  label: 'MMTS',  icon: '🚆', color: '#8B4513' },
]

export function MapLayerControl({ layers, onChange, baseTile, onBaseTileChange, showOverlays = true }) {
  return (
    <div className="map-layer-control" role="group" aria-label="Map controls">

      <span className="map-layer-control__title">Base Map</span>
      <div className="map-tile-row">
        {BASE_TILES.map(({ key, label, icon }) => (
          <button
            key={key}
            className={`map-tile-btn${baseTile === key ? ' --on' : ''}`}
            onClick={() => onBaseTileChange?.(key)}
            aria-pressed={baseTile === key}
            aria-label={`${label} map`}
            title={`Switch to ${label}`}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {showOverlays && (
        <>
          <span className="map-layer-control__title" style={{ marginTop: 6 }}>Overlays</span>
          {OVERLAYS.map(({ key, label, icon, color }) => {
            const active = layers[key]
            return (
              <button
                key={key}
                className={`map-layer-btn${active ? ' --on' : ''}`}
                style={active ? { borderColor: color, color, background: `${color}18` } : {}}
                onClick={() => onChange({ ...layers, [key]: !active })}
                aria-pressed={active}
                aria-label={`${active ? 'Hide' : 'Show'} ${label} network`}
                title={`${active ? 'Hide' : 'Show'} ${label} network`}
              >
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
