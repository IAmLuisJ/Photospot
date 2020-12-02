import React, { useState, useContext } from "react";
import { View, StyleSheet } from "react-native";
import { Button, TextInput, Text } from "react-native-paper";
import { Context as AuthContext } from "../context/AuthContext";

const SignupScreen = ({ navigation }) => {
  const { state, signUp } = useContext(AuthContext);
  const [email, setEmail] = useState("");
  const [userPass, setUserPass] = useState("");

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
      {state.errorMessage ? <Text>{state.errorMessage}</Text> : null}
      <Button onPress={() => signUp({ email, userPass })}>Sign Up</Button>
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
