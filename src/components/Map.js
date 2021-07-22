import React, { useContext } from "react";
import { View, Text, StyleSheet } from "react-native";
import MapView, { Circle, Polyline, Marker } from "react-native-maps";
import { ActivityIndicator } from "react-native-paper";
import { Context as LocationContext } from "../context/LocationContext";

const Map = () => {
  const {
    state: { currentLocation, locations },
  } = useContext(LocationContext);

  if (!currentLocation) {
    return <ActivityIndicator animating={true} />;
  }
  return (
    <View>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
      >
        <Marker
          draggable
          coordinate={{
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
          }}
        />
        <Circle
          center={{
            longitude: currentLocation.coords.longitude,
            latitude: currentLocation.coords.latitude,
          }}
          radius={30}
          strokeColor="rgba(158, 158, 255, 1.0)"
          fillColor="rgba(158, 158, 255, 0.3)"
        />
        <Polyline coordinates={locations.map((point) => point.coords)} />
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  map: {
    height: 400,
  },
});

export default Map;
