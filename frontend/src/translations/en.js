export const en = {
  // Header
  appTitle: 'TravelMate',
  appSub: 'Hyderabad Transit',
  langToggle: 'తెలుగు',

  // Search panel
  from: 'From',
  to: 'To',
  fromPlaceholder: 'Enter starting point…',
  toPlaceholder: 'Enter destination…',
  findRoutes: 'Find Routes',
  findingRoutes: 'Finding routes…',
  useMyLocation: 'Use my location',
  swap: 'Swap',
  searching: 'Searching…',

  // Route results
  findingBest: 'Finding the best routes…',
  noRoutes: 'No routes found. The locations may be outside Hyderabad or too far from any transit stop.',
  noService: (mode) => `No ${mode} service on this route`,

  // Mode labels
  metro: 'Metro',
  bus: 'Bus',
  mmts: 'MMTS',
  walk: 'Walk',
  auto: 'Auto',

  // Route card
  duration: 'Duration',
  cost: 'Cost',
  walking: 'Walking',
  transfers: 'Transfers',
  fastest: '⚡ Fastest',
  cheapest: '₹ Cheapest',
  showSteps: 'Show details',
  hideSteps: 'Hide details',

  // Route step
  stops: 'stops',
  stop: 'stop',
  board: 'Board',
  alightAt: 'Alight at',
  walkTo: 'Walk',
  takeAuto: 'Take auto-rickshaw',

  // Map tooltips
  mapFrom: 'From',
  mapTo: 'To',
  mapWalk: 'Walk',
  mapAuto: 'Auto',
  mapTransfer: 'Transfer',

  // Bus service level badges
  serviceHigh:   '🔥 Very Frequent',
  serviceMedium: '🕐 Moderate',
  serviceLow:    '⚠ Low Frequency',
  everyMins:     (n) => `every ~${n} min`,

  // Commuter intelligence
  majorCorridor:   '🛣 Major corridor',
  frequentService: '⚡ Frequent service',
  regularService:  '🔄 Regular service',
  limitedService:  '⚠ Limited service',
  commuterScore:   'Commuter score',
  recommended:     'Recommended',

  // Safety panel
  safetyAnalysis:  'Safety Analysis',
  routeSafety:     'Route Safety',
  noRiskZones:     '✅ No high-risk zones on this corridor',
  peakRisk:        'Peak risk',

  // Live conditions
  liveConditions:  'Live',
  trafficFree:     'Free flow',
  trafficModerate: 'Moderate traffic',
  trafficHeavy:    'Heavy traffic',
  trafficStall:    'Standstill',
  weatherClear:    'Clear',

  // Recent locations & sharing
  recentPlaces: 'Recent',
  shareRoute:   '⎘ Share',
  copied:       '✓ Copied!',
}
