import React, { useContext } from "react";
import { View, Text, StyleSheet } from "react-native";
import MapView, { Polyline } from "react-native-maps";
import { Context as SpotContext } from "../context/SpotContext";

const SpotDetailScreen = ({ navigation }) => {
  const { state } = useContext(SpotContext);
  const _id = navigation.getParam("_id");
  const spot = state.find((t) => t._id === _id);
  const initialCoordinates = spot.locations[0].coords;

  return (
    <View>
      <Text>{spot.name}</Text>
      <MapView
        style={styles.map}
        initialRegion={{
          longitudeDelta: 0.01,
          latitudeDelta: 0.01,
          ...initialCoordinates,
        }}
      >
        <Polyline coordinates={spot.locations.map((loc) => loc.coords)} />
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  map: {
    height: 400,
  },
});

export default SpotDetailScreen;
