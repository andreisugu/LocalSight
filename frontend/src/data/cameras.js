// Demo cameras: the three seeded airport feeds plus the local browser camera.
//
// Each camera carries its own labels and overlay boxes, because the Live screen has to
// look like the apron even when the engine is stopped. `zone_id` points at the zone the
// camera is seeded with; `boxes` are presentation only and never reach the API.

const frame = (top, left, width, height) => ({ top, left, width, height });

const CAMERA_FIXTURES = [
  {
    id: 'stand12',
    code: 'CAM-01',
    name: 'CAM-01 • Stand 12 — apron',
    subtitle: 'Alimentare & Întreținere (Zonă Motor Apron)',
    category: 'Alimentare & Rampă',
    zone_id: 'engine-left',
    rtsp_url: 'rtsp://edge.airport.local/live/stand12',
    status: 'online',
    engine_on: true,
    fps: 30,
    resolution: '1080p 30FPS',
    previewBg: 'from-[#1F1F1F] via-[#282828] to-[#181818]',
    boxes: [
      {
        id: 'box-stand12-1',
        label: 'Persoană #17 în zona motorului',
        type: 'critical',
        coords: frame('46%', '22%', '11%', '30%'),
        trackingId: 'track_17',
        details: 'Persoană în raza motorului stâng, cu motorul pornit (2,6 s)',
      },
      {
        id: 'box-stand12-2',
        label: 'Zonă motor stâng (engine-left)',
        type: 'warning',
        coords: frame('44%', '3%', '59%', '43%'),
        trackingId: 'engine-left',
        details: 'active_when: engine_on = true',
      },
    ],
  },
  {
    id: 'taxiway-b',
    code: 'CAM-02',
    name: 'CAM-02 • Taxiway B',
    subtitle: 'Cale de rulare & linia de așteptare 08R',
    category: 'Pistă & Căi Rulare',
    zone_id: 'taxiway-b',
    rtsp_url: 'rtsp://edge.airport.local/live/taxiway-b',
    status: 'online',
    engine_on: false,
    fps: 30,
    resolution: '720p 30FPS',
    previewBg: 'from-zinc-900 to-neutral-800',
    boxes: [
      {
        id: 'box-taxiway-b-1',
        label: 'Persoană #23 la linia de așteptare',
        type: 'critical',
        coords: frame('58%', '57%', '8%', '22%'),
        trackingId: 'track_23',
        details: 'Traversare peste banda de siguranță, aeronavă în rulare',
      },
      {
        id: 'box-taxiway-b-2',
        label: 'Aeronavă în rulare YR-BMA',
        type: 'warning',
        coords: frame('34%', '24%', '32%', '24%'),
        trackingId: 'ac_08r',
        details: 'Viteză redusă, motor pornit, direcție 08R',
      },
    ],
  },
  {
    id: 'baggage-area',
    code: 'CAM-03',
    name: 'CAM-03 • Bagaje — poarta',
    subtitle: 'Triere & Încărcare Bagaje (Rampă Sud)',
    category: 'Terminal & Porți',
    zone_id: 'baggage-area',
    rtsp_url: 'rtsp://edge.airport.local/live/baggage-area',
    status: 'online',
    engine_on: false,
    fps: 24,
    resolution: '1080p 24FPS',
    previewBg: 'from-[#222222] to-[#181818]',
    boxes: [
      {
        id: 'box-baggage-1',
        label: 'Persoană #41 fără vestă hi-vis',
        type: 'warning',
        coords: frame('48%', '38%', '10%', '26%'),
        trackingId: 'track_41',
        details: 'Operator pe banda 2 de triere, fără echipament vizibil',
      },
    ],
  },
  {
    // The only camera that is not a network feed: the browser opens the visitor's own
    // device with getUserMedia. It has no RTSP URL and no clip, Live treats it separately,
    // and its zone is drawn like any other configured zone.
    id: 'webcam-live',
    code: 'CAM-LOCAL',
    name: 'CAM-LOCAL • Cameră browser',
    subtitle: 'Camera laptopului — flux local, procesat în browser',
    category: 'Local & Browser',
    zone_id: 'webcam-view',
    rtsp_url: null,
    status: 'online',
    engine_on: false,
    fps: 30,
    resolution: '720p',
    // Cyan accent, the same colour as the in-browser engine: reads as a local source,
    // not as an airport feed.
    previewBg: 'from-[#0B2B33] via-[#0E3A45] to-[#111111]',
    boxes: [],
  },
];

export const INITIAL_CAMERAS = CAMERA_FIXTURES;
