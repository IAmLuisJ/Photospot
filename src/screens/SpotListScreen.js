import React, { useContext } from "react";
import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { NavigationEvents } from "react-navigation";
import { Context as SpotContext } from "../context/SpotContext";
import { ListItem } from "react-native-elements";

const SpotListScreen = ({ navigation }) => {
  const { state, fetchSpots } = useContext(SpotContext);
  return (
    <View>
      <NavigationEvents onWillFocus={fetchSpots} />
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
              <ListItem>
                <ListItem.Title>{item.name}</ListItem.Title>
                <ListItem.Chevron />
              </ListItem>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
};

export default SpotListScreen;
