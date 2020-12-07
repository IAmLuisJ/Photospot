import React, { useContext } from "react";
import { View, Text } from "react-native";
import { Button } from "react-native-paper";
import Map from "../components/Map";
import { Context as LocationContext } from "../context/LocationContext";
import useLocation from "../hooks/useLocation";

const SpotCreateScreen = () => {
  const { addLocation } = useContext(LocationContext);
  const [err] = useLocation((location) => {
    addLocation(location);
  });

  return (
    <View style={{ margin: 15, flex: 1, justifyContent: "center" }}>
      <Button>Create new Spot</Button>
      <Map />
      {err ? <Text>Please turn on Location Services</Text> : null}
    </View>
  );
};

export default SpotCreateScreen;
