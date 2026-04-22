import { useState } from 'react';
import { Button, StyleSheet, View } from 'react-native';
import {
  Camera,
  CircleLayer,
  MapView,
  ShapeSource,
  StyleImport,
  UserLocation,
  UserTrackingMode,
} from '@rnmapbox/maps';
// @ts-ignore - Missing types for @turf packages
import { point as makePoint } from '@turf/helpers';

type Coord = [number, number];

const StyleImportConfig = () => {
  const [turnByTurnEnabled, setTurnByTurnEnabled] = useState(true);
  const [destination, setDestination] = useState<Coord | null>(null);

  return (
    <View style={styles.container}>
      <Button
        title={
          turnByTurnEnabled
            ? 'Disable turn-by-turn camera'
            : 'Enable turn-by-turn camera'
        }
        onPress={() => {
          setTurnByTurnEnabled((enabled) => !enabled);
        }}
      />
      <MapView
        style={styles.mapView}
        styleURL={'mapbox://styles/mapbox/standard-beta'}
        onLongPress={(event: GeoJSON.Feature<GeoJSON.Point>) => {
          const { coordinates } = event.geometry;
          setDestination(coordinates as Coord);
        }}
      >
        <Camera
          followUserLocation={turnByTurnEnabled}
          followUserMode={UserTrackingMode.FollowWithCourse}
          followZoomLevel={17}
          followPitch={60}
          defaultSettings={{
            centerCoordinate: [73.54, 4.21],
            zoomLevel: 16,
            pitch: 60,
          }}
        />
        <UserLocation visible showsUserHeadingIndicator />
        <StyleImport
          id="basemap"
          existing
          config={{
            lightPreset: 'night',
          }}
        />
        {destination && (
          <ShapeSource id="destination-point" shape={makePoint(destination)}>
            <CircleLayer
              id="destination-circle"
              style={{
                circleRadius: 8,
                circleColor: '#eb5757',
                circleStrokeColor: '#ffffff',
                circleStrokeWidth: 2,
              }}
            />
          </ShapeSource>
        )}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapView: { flex: 1 },
});

/* end-example-doc */

const metadata = {
  title: 'Style Import Config',
  tags: ['StyleImport', 'v11'],
  docs: `
# Style Import Config

This example applies v11 style import config with a night preset and enables
a turn-by-turn style camera that follows the user location with a 60° pitch.
Long-press to drop a destination marker.
`,
};

StyleImportConfig.metadata = metadata;

export default StyleImportConfig;
