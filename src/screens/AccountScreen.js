import React from "react";
import { View, Text, StyleSheet } from "react-native";

const AccountScreen = () => {
  return (
    <View>
      <Text style={styles.textStyle}>Account</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  textStyle: {
    fontSize: 15,
  },
});

export default AccountScreen;
