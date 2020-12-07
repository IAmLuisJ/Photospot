import { requestPermissionsAsync } from "expo-location";
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import MapView, { Polyline } from "react-native-maps";

const Map = () => {
  const [userLocation, setUserLocation] = useState();

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
        console.log("Permission not grante");
      } else {
        console.log("Permission granted");
      }
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {}, []);

  return (
    <View>
      <Text>Map</Text>
      <MapView style={styles.map}>
        <Polyline coordinates={points} />
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
