import React from "react";
import { View, Text } from "react-native";
import { Button } from "react-native-paper";

const SpotListScreen = ({ navigation }) => {
  return (
    <View>
      <Text>Spot list</Text>
      <Button onPress={() => navigation.navigate("SpotDetail")}>
        Detail view
      </Button>
    </View>
  );
};

export default SpotListScreen;
