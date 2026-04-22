import { Button } from 'react-native';
import { useState } from 'react';
import {
  MapView,
  Camera,
  StyleImport,
  UserLocation,
  UserTrackingMode,
} from '@rnmapbox/maps';

const HULHUMALE_COORDINATES: [number, number] = [73.54, 4.21];

const StyleImportConfig = () => {
  const [lightPreset, setLightPreset] = useState('night');
  const nextLightPreset = lightPreset === 'night' ? 'day' : 'night';

  return (
    <>
      <Button
        title={`Change to ${nextLightPreset}`}
        onPress={() => {
          setLightPreset(nextLightPreset);
        }}
      />
      <MapView
        style={styles.mapView}
        styleURL={'mapbox://styles/mapbox/standard-beta'}
      >
        <Camera
          defaultSettings={{ centerCoordinate: HULHUMALE_COORDINATES }}
          followUserLocation
          followUserMode={UserTrackingMode.FollowWithHeading}
          followZoomLevel={18}
          pitch={33}
          animationDuration={0}
        />
        <UserLocation visible showsUserHeadingIndicator />
        <StyleImport
          id="basemap"
          existing
          config={{
            lightPreset: lightPreset,
          }}
        />
      </MapView>
    </>
  );
};

const styles = {
  mapView: { flex: 1 },
};

/* end-example-doc */

const metadata = {
  title: 'Style Import Config',
  tags: ['StyleImport', 'v11'],
  docs: `
# Style Import Config

This example shows how to change style import configs - v11 only.
`,
};

StyleImportConfig.metadata = metadata;

export default StyleImportConfig;
