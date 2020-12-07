import {
  Accuracy,
  requestPermissionsAsync,
  watchPositionAsync,
  getCurrentPositionAsync,
} from "expo-location";
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import MapView, { Polyline } from "react-native-maps";

const Map = () => {
  const [userLocation, setUserLocation] = useState(null);
  const [locationError, setlocationError] = useState("");

  const points = [];
  for (let i = 0; i < 15; i++) {
    points.push({
      latitude: 37.78825 + i * 0.001,
      longitude: -122.4324 + i * 0.001,
    });
  }

  const startWatchingLocation = async () => {
    try {
      const { granted } = await requestPermissionsAsync;
      if (!granted) {
        console.log("Permission not granted");
      } else {
        console.log("Permission granted");
        await watchPositionAsync(
          {
            accuracy: Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 10,
          },
          (location) => {
            console.log(location);
          }
        );
      }
      let currentLocation = await getCurrentPositionAsync();
      setUserLocation(currentLocation);
    } catch (err) {
      setlocationError(err);
      console.log(err);
    }
  };

  useEffect(() => {
    startWatchingLocation();
  }, []);

  return (
    <View>
      <Text>Map</Text>
      <MapView style={styles.map}>
        <Polyline coordinates={points} />
      </MapView>
      {locationError ? <Text>Please turn on Location Services</Text> : null}
      {userLocation ? <Text>{userLocation}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  map: {
    height: 400,
  },
});

export default Map;
