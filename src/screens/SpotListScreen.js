import React, { useContext } from "react";
import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { List } from "react-native-paper";
import { NavigationEvents } from "react-navigation";
import { Context as SpotContext } from "../context/SpotContext";

const SpotListScreen = ({ navigation }) => {
  const { state, fetchSpots } = useContext(SpotContext);
  return (
    <View>
      <NavigationEvents onWillFocus={fetchSpots} />
      <Text>Spot list</Text>

      <FlatList
        data={state}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => {
          return (
            <TouchableOpacity
              onPress={() =>
                navigation.navigate("SpotDetail", { _id: item._id })
              }
            >
              <List.Item title={item.name} />
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
};

export default SpotListScreen;
