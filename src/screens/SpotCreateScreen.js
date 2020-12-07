import React from "react";
import { View, Text } from "react-native";
import { Button } from "react-native-paper";
import Map from "../components/Map";

const SpotCreateScreen = () => {
  return (
    <View style={{ margin: 15, flex: 1, justifyContent: "center" }}>
      <Button>Create new Spot</Button>
      <Map />
    </View>
  );
};

export default SpotCreateScreen;
