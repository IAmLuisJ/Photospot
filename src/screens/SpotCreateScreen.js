import React, { useCallback, useContext } from "react";
import { Text, ScrollView, SafeAreaView } from "react-native";
import { Button } from "react-native-paper";
import Map from "../components/Map";
import { withNavigationFocus } from "react-navigation";
import { Context as LocationContext } from "../context/LocationContext";
import useLocation from "../hooks/useLocation";
import TrackForm from "../components/TrackForm";
import { FontAwesome } from "@expo/vector-icons";

const SpotCreateScreen = ({ isFocused }) => {
  const { state, addLocation } = useContext(LocationContext);

  const callback = useCallback(
    (location) => {
      addLocation(location, state.recording);
    },
    [state.recording]
  );

  const [err] = useLocation(isFocused || state.recording, callback);

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 35 }}>
      <Button>Create new Spot</Button>
      <Map />
      {err ? <Text>Please turn on Location Services</Text> : null}
      <TrackForm />
    </ScrollView>
  );
};

SpotCreateScreen.navigationOptions = () => {
  return {
    title: "Add New Spot",
    tabBarIcon: <FontAwesome name="plus" size={20} />,
  };
};

export default withNavigationFocus(SpotCreateScreen);
