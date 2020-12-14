import React, { useContext } from "react";
import { StyleSheet, ScrollView } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { Card, Title, Paragraph, Button } from "react-native-paper";
import { Context as SpotContext } from "../context/SpotContext";

const SpotDetailScreen = ({ navigation }) => {
  const { state, deleteSpot } = useContext(SpotContext);
  const _id = navigation.getParam("_id");
  const spot = state.find((t) => t._id === _id);
  const initialCoordinates = spot.location.coords;

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
          <Marker
            coordinate={{
              latitude: spot.location.coords.latitude,
              longitude: spot.location.coords.longitude,
            }}
          />
        </MapView>

        <Card.Title title={spot.title} />
        <Card.Content>
          <Title>{spot.name}</Title>
          <Paragraph>{spot.description}</Paragraph>
          <Card.Actions>
            <Button mode="contained" icon="camera">
              Share
            </Button>
            <Button
              onPress={() => {
                navigation.navigate("SpotList");
                deleteSpot(_id);
              }}
            >
              Delete
            </Button>
          </Card.Actions>
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
