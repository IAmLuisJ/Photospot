import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Button, TextInput } from "react-native-paper";

const SignupScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [userPass, setUserPass] = useState("");

  const SignUpUser = () => {};

  return (
    <View style={styles.container}>
      <TextInput
        label="Email"
        onChangeText={(e) => setEmail(e)}
        value={email}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        label="Password"
        value={userPass}
        onChangeText={(e) => setUserPass(e)}
        secureTextEntry={true}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button onPress={() => navigation.navigate("mainFlow")}>Sign Up</Button>
      <Button onPress={() => navigation.navigate("Signin")}>
        Already Registered? Sign in here
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    margin: 15,
    padding: 5,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    marginBottom: 250,
  },
});

SignupScreen.navigationOptions = () => {
  return {
    headerShown: false,
  };
};

export default SignupScreen;
