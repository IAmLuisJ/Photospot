import React from "react";
import { View, StyleSheet } from "react-native";

const Spacer = ({ children }) => {
  return <View style={styles.space}>{children}</View>;
};

const styles = StyleSheet.create({
  space: {
    margin: 15,
  },
});

export default Spacer;
