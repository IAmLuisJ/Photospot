import React, { useContext } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Button } from "react-native-paper";
import { Context as AuthContext } from "../context/AuthContext";
const AccountScreen = ({ navigation }) => {
  const { signOut } = useContext(AuthContext);

  return (
    <View style={styles.container}>
      <Text style={styles.textStyle}>Account</Text>
      <Button onPress={signOut}>Sign out</Button>
    </View>
  );
};

const styles = StyleSheet.create({
  textStyle: {
    fontSize: 15,
    margin: 15,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    marginBottom: 250,
  },
});

export default AccountScreen;
