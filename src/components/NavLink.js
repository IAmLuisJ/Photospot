import React from "react";
import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { withNavigation } from "react-navigation";

const NavLink = ({ navigation, linkText, routeName }) => {
  return (
    <>
      <TouchableOpacity
        onPress={() => {
          navigation.navigate(routeName);
        }}
      >
        <Text>{linkText}</Text>
      </TouchableOpacity>
    </>
  );
};

const style = StyleSheet.create({});

export default withNavigation(NavLink);
