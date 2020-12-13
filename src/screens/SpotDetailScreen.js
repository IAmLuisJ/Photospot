import React, { useContext } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import MapView, { Polyline } from "react-native-maps";
import { Card, Title, Paragraph, Button } from "react-native-paper";
import { Context as SpotContext } from "../context/SpotContext";

const SpotDetailScreen = ({ navigation }) => {
  const { state } = useContext(SpotContext);
  const _id = navigation.getParam("_id");
  const spot = state.find((t) => t._id === _id);
  const initialCoordinates = spot.locations[0].coords;

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 50 }}>
      <Card>
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

        <Card.Title title={spot.title} />
        <Card.Content>
          <Title>{spot.name}</Title>
          <Paragraph>Paragraph Content</Paragraph>
        </Card.Content>
      </Card>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  map: {
    height: 400,
  },
});

SpotDetailScreen.navigationOptions = ({ navigation }) => {
  return {
    title: navigation.getParam("name"),
  };
};

export default SpotDetailScreen;
