import React, { useCallback, useContext } from "react";
import { Text, ScrollView, SafeAreaView } from "react-native";
import Map from "../components/Map";
import { withNavigationFocus } from "react-navigation";
import { Context as LocationContext } from "../context/LocationContext";
import useLocation from "../hooks/useLocation";
import { FontAwesome } from "@expo/vector-icons";
import SpotForm from "../components/SpotForm";

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
      <Map />
      {err ? <Text>Please turn on Location Services</Text> : null}
      <SpotForm />
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
