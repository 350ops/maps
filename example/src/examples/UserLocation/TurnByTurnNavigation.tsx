import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Camera,
  CircleLayer,
  LineLayer,
  Location,
  MapView,
  ShapeSource,
  StyleImport,
  UserLocation,
  UserTrackingMode,
} from '@rnmapbox/maps';
// @ts-ignore - Missing types for @turf packages
import nearestPointOnLine from '@turf/nearest-point-on-line';
// @ts-ignore - Missing types for @turf packages
import turfLength from '@turf/length';
// @ts-ignore - Missing types for @turf packages
import { lineString as makeLineString, point as makePoint } from '@turf/helpers'; // prettier-ignore

import { directionsClient } from '../../MapboxClient';
import RouteSimulator from '../../utils/RouteSimulator';
import { ExampleWithMetadata } from '../common/ExampleMetadata'; // exclude-from-example-doc

type Coord = [number, number];

type Maneuver = {
  instruction: string;
  type: string;
  modifier?: string;
  location: Coord;
};

type Step = {
  maneuver: Maneuver;
  distance: number;
  duration: number;
  name: string;
  geometry: { type: 'LineString'; coordinates: Coord[] };
};

type Route = {
  geometry: { type: 'LineString'; coordinates: Coord[] };
  distance: number;
  duration: number;
  legs: Array<{ steps: Step[] }>;
};

const OFF_ROUTE_METERS = 50;
const OFF_ROUTE_TICKS = 4;
const ARRIVED_METERS = 20;

const routeStyle = {
  lineColor: '#2f80ed',
  lineWidth: 7,
  lineOpacity: 0.9,
  lineCap: 'round' as const,
  lineJoin: 'round' as const,
};
const traveledStyle = {
  lineColor: '#9aa5b1',
  lineWidth: 7,
  lineOpacity: 0.9,
  lineCap: 'round' as const,
  lineJoin: 'round' as const,
};
const destinationStyle = {
  circleRadius: 8,
  circleColor: '#eb5757',
  circleStrokeWidth: 2,
  circleStrokeColor: '#fff',
};

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${m} min`;
}

// Pick an emoji-ish arrow from a Mapbox maneuver modifier.
function maneuverArrow(m?: Maneuver): string {
  if (!m) return '•';
  const key = `${m.type}:${m.modifier ?? ''}`;
  if (m.type === 'arrive') return '◉';
  if (m.type === 'depart') return '↑';
  if (m.type === 'roundabout' || m.type === 'rotary') return '↻';
  switch (m.modifier) {
    case 'left':
      return '←';
    case 'right':
      return '→';
    case 'sharp left':
      return '↖';
    case 'sharp right':
      return '↗';
    case 'slight left':
      return '↰';
    case 'slight right':
      return '↱';
    case 'straight':
      return '↑';
    case 'uturn':
      return '↺';
    default:
      return key.includes('left') ? '←' : key.includes('right') ? '→' : '↑';
  }
}

const TurnByTurnNavigation = () => {
  const [destination, setDestination] = useState<Coord | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [currentLocation, setCurrentLocation] = useState<Coord | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [distanceToManeuver, setDistanceToManeuver] = useState(0);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [remainingDuration, setRemainingDuration] = useState(0);
  const [snappedPoint, setSnappedPoint] = useState<Coord | null>(null);
  const [arrived, setArrived] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const offRouteTicksRef = useRef(0);
  const simulatorRef = useRef<RouteSimulator | null>(null);

  const steps: Step[] = useMemo(
    () => route?.legs.flatMap((leg) => leg.steps) ?? [],
    [route],
  );
  const currentStep = steps[stepIdx];
  const nextStep = steps[stepIdx + 1];
  const bannerManeuver = nextStep?.maneuver ?? currentStep?.maneuver;
  const bannerText =
    bannerManeuver?.instruction ?? (arrived ? 'You have arrived' : '');

  const routeGeoJSON = useMemo(() => {
    if (!route) return null;
    return makeLineString(route.geometry.coordinates);
  }, [route]);

  const traveledGeoJSON = useMemo(() => {
    if (!route || !snappedPoint) return null;
    // Build traveled polyline: route coords up to snappedPoint + the snappedPoint itself.
    const coords = route.geometry.coordinates;
    // Find the segment index of the snapped point via nearestPointOnLine again
    // is cheap; but we already have snappedPoint. Re-snap to read `index`.
    const line = makeLineString(coords);
    const snapped = nearestPointOnLine(line, makePoint(snappedPoint), {
      units: 'kilometers',
    });
    const idx: number = snapped.properties.index ?? 0;
    const traveled = coords.slice(0, idx + 1);
    traveled.push(snappedPoint);
    if (traveled.length < 2) return null;
    return makeLineString(traveled);
  }, [route, snappedPoint]);

  const fetchRoute = useCallback(async (from: Coord, to: Coord) => {
    setRouting(true);
    setRouteError(null);
    try {
      const res = await directionsClient
        .getDirections({
          profile: 'driving-traffic',
          waypoints: [{ coordinates: from }, { coordinates: to }],
          geometries: 'geojson',
          steps: true,
          overview: 'full',
        })
        .send();
      const r = res.body.routes?.[0] as Route | undefined;
      if (!r) {
        setRouteError('No route found');
        setRoute(null);
        return;
      }
      setRoute(r);
      setStepIdx(0);
      setArrived(false);
      offRouteTicksRef.current = 0;
    } catch (e) {
      setRouteError((e as Error).message ?? 'Route request failed');
      setRoute(null);
    } finally {
      setRouting(false);
    }
  }, []);

  const onLongPress = useCallback(
    (feature: GeoJSON.Feature<GeoJSON.Point>) => {
      const coords = feature.geometry.coordinates as Coord;
      setDestination(coords);
      if (currentLocation) fetchRoute(currentLocation, coords);
    },
    [currentLocation, fetchRoute],
  );

  // Handle incoming position (real or simulated) — computes step progress,
  // remaining distance/time, arrival, and off-route reroute.
  const handlePosition = useCallback(
    (coord: Coord) => {
      setCurrentLocation(coord);

      if (!route || arrived) return;

      const line = makeLineString(route.geometry.coordinates);
      const snapped = nearestPointOnLine(line, makePoint(coord), {
        units: 'kilometers',
      });
      const snappedCoord = snapped.geometry.coordinates as Coord;
      const distFromRouteM = (snapped.properties.dist ?? 0) * 1000;
      setSnappedPoint(snappedCoord);

      // Off-route detection
      if (distFromRouteM > OFF_ROUTE_METERS) {
        offRouteTicksRef.current += 1;
        if (offRouteTicksRef.current >= OFF_ROUTE_TICKS && destination) {
          offRouteTicksRef.current = 0;
          fetchRoute(coord, destination);
          return;
        }
      } else {
        offRouteTicksRef.current = 0;
      }

      // Distance to end of current step = step length - how far into step we are.
      // Use turf length on current step geometry, then snap within that step.
      const curStep = steps[stepIdx];
      if (!curStep) return;
      const stepLine = makeLineString(curStep.geometry.coordinates);
      const stepSnap = nearestPointOnLine(stepLine, makePoint(snappedCoord), {
        units: 'kilometers',
      });
      const stepTotalKm = turfLength(stepLine, { units: 'kilometers' });
      const intoStepKm = stepSnap.properties.location ?? 0;
      const remStepKm = Math.max(0, stepTotalKm - intoStepKm);
      const remStepM = remStepKm * 1000;
      setDistanceToManeuver(remStepM);

      // Remaining route distance = remStep + sum of remaining step lengths.
      let remM = remStepM;
      for (let i = stepIdx + 1; i < steps.length; i++) {
        const s = steps[i];
        if (s) remM += s.distance;
      }
      setRemainingDistance(remM);
      // Rough remaining time: scale by avg speed of full route.
      const avgSpeed = route.distance / Math.max(1, route.duration); // m/s
      setRemainingDuration(remM / Math.max(0.5, avgSpeed));

      // Advance step when we're within 10m of the next maneuver point.
      if (remStepM < 10 && stepIdx < steps.length - 1) {
        setStepIdx(stepIdx + 1);
      }

      // Arrival: near last coord of route.
      const lastCoord = route.geometry.coordinates[
        route.geometry.coordinates.length - 1
      ] as Coord;
      const lastPoint = makePoint(lastCoord);
      const distToEndM =
        (nearestPointOnLine(line, lastPoint, { units: 'kilometers' }).properties
          .location ?? 0) * 1000;
      const userAlongM = (snapped.properties.location ?? 0) * 1000;
      if (distToEndM - userAlongM < ARRIVED_METERS) {
        setArrived(true);
        setSimulating(false);
        simulatorRef.current?.stop();
      }
    },
    [route, steps, stepIdx, destination, arrived, fetchRoute],
  );

  const onUserLocationUpdate = useCallback(
    (loc: Location) => {
      if (simulating) return; // simulator drives position when on
      const { longitude, latitude } = loc.coords;
      handlePosition([longitude, latitude]);
    },
    [handlePosition, simulating],
  );

  // Start/stop simulator
  useEffect(() => {
    if (!simulating || !route) {
      simulatorRef.current?.stop();
      simulatorRef.current = null;
      return;
    }
    const sim = new RouteSimulator(makeLineString(route.geometry.coordinates));
    sim.addListener((pt: GeoJSON.Feature<GeoJSON.Point>) => {
      const c = pt.geometry.coordinates as Coord;
      handlePosition(c);
    });
    sim.start();
    simulatorRef.current = sim;
    return () => sim.stop();
  }, [simulating, route, handlePosition]);

  const cancelRoute = () => {
    simulatorRef.current?.stop();
    simulatorRef.current = null;
    setSimulating(false);
    setRoute(null);
    setDestination(null);
    setArrived(false);
    setStepIdx(0);
    setSnappedPoint(null);
  };

  const hasRoute = !!route && !arrived;

  return (
    <View style={styles.root}>
      <MapView
        style={styles.map}
        pitchEnabled
        rotateEnabled
        onLongPress={(f: GeoJSON.Feature<GeoJSON.Point>) => onLongPress(f)}
      >
        <Camera
          followUserLocation={!arrived}
          followUserMode={
            hasRoute
              ? UserTrackingMode.FollowWithCourse
              : UserTrackingMode.Follow
          }
          followZoomLevel={hasRoute ? 17 : 15}
          followPitch={hasRoute ? 55 : 0}
        />
        <UserLocation
          visible
          showsUserHeadingIndicator
          onUpdate={onUserLocationUpdate}
        />

        {routeGeoJSON && (
          <ShapeSource id="nav-route" shape={routeGeoJSON}>
            <LineLayer id="nav-route-line" style={routeStyle} />
          </ShapeSource>
        )}
        {traveledGeoJSON && (
          <ShapeSource id="nav-traveled" shape={traveledGeoJSON}>
            <LineLayer
              id="nav-traveled-line"
              style={traveledStyle}
              aboveLayerID="nav-route-line"
            />
          </ShapeSource>
        )}
        {destination && (
          <ShapeSource id="nav-dest" shape={makePoint(destination)}>
            <CircleLayer id="nav-dest-circle" style={destinationStyle} />
          </ShapeSource>
        )}
      </MapView>

      {/* Top banner */}
      {hasRoute && bannerManeuver && (
        <View style={styles.banner}>
          <Text style={styles.bannerArrow}>
            {maneuverArrow(bannerManeuver)}
          </Text>
          <View style={styles.bannerTextWrap}>
            <Text style={styles.bannerDist}>
              {formatDistance(distanceToManeuver)}
            </Text>
            <Text style={styles.bannerInstruction} numberOfLines={2}>
              {bannerText}
            </Text>
          </View>
        </View>
      )}

      {/* Routing spinner */}
      {routing && (
        <View style={styles.routingOverlay}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.routingText}>Finding route…</Text>
        </View>
      )}

      {/* Route error */}
      {routeError && (
        <View style={[styles.routingOverlay, { backgroundColor: '#c0392b' }]}>
          <Text style={styles.routingText}>{routeError}</Text>
        </View>
      )}

      {/* Arrival */}
      {arrived && (
        <View style={styles.arrived}>
          <Text style={styles.arrivedText}>You have arrived</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={cancelRoute}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        {!route && !routing && (
          <Text style={styles.hint}>
            Long-press anywhere on the map to set a destination.
          </Text>
        )}
        {hasRoute && (
          <>
            <View style={styles.etaRow}>
              <Text style={styles.eta}>
                {formatDuration(remainingDuration || route.duration)}
              </Text>
              <Text style={styles.etaSub}>
                {formatDistance(remainingDistance || route.distance)}
              </Text>
            </View>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.secondaryBtn, simulating && styles.btnActive]}
                onPress={() => setSimulating((s) => !s)}
              >
                <Text style={styles.secondaryBtnText}>
                  {simulating ? 'Stop sim' : 'Simulate'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dangerBtn} onPress={cancelRoute}>
                <Text style={styles.dangerBtnText}>End</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  banner: {
    position: 'absolute',
    top: 16,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(20,24,32,0.95)',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bannerArrow: {
    color: '#fff',
    fontSize: 34,
    marginRight: 14,
    width: 40,
    textAlign: 'center',
  },
  bannerTextWrap: { flex: 1 },
  bannerDist: { color: '#9aa5b1', fontSize: 14, marginBottom: 2 },
  bannerInstruction: { color: '#fff', fontSize: 18, fontWeight: '600' },
  routingOverlay: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,24,32,0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  routingText: { color: '#fff', marginLeft: 8 },
  arrived: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(20,24,32,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrivedText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 24,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 4,
  },
  hint: { color: '#555', textAlign: 'center', paddingVertical: 4 },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 },
  eta: { fontSize: 24, fontWeight: '700', color: '#27ae60' },
  etaSub: { fontSize: 16, color: '#555', marginLeft: 10 },
  btnRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    backgroundColor: '#2f80ed',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#eef2f7',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#333', fontWeight: '600' },
  btnActive: { backgroundColor: '#d6e6ff' },
  dangerBtn: {
    backgroundColor: '#eb5757',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  dangerBtnText: { color: '#fff', fontWeight: '600' },
});

export default TurnByTurnNavigation;
/* end-example-doc */

const metadata: ExampleWithMetadata['metadata'] = {
  title: 'Turn-by-Turn Navigation',
  tags: [
    'UserLocation',
    'Camera#followUserLocation',
    'ShapeSource',
    'LineLayer',
    'MapView#onLongPress',
  ],
  docs: `
DIY turn-by-turn navigation built on the Mapbox Directions API and this library's
UserLocation/Camera/ShapeSource/LineLayer primitives.

Long-press the map to set a destination. The app fetches a driving-traffic route
with turn-by-turn steps, draws the route, locks the camera to the user puck with
course-follow + pitch, and shows a live maneuver banner with distance to the next
turn. It reroutes automatically when you drift off-route, and shows an "arrived"
screen at the destination.

The iOS simulator does not move your GPS — tap "Simulate" to animate a simulated
driver along the route for testing.
`,
  disableSync: true,
};
TurnByTurnNavigation.metadata = metadata;
