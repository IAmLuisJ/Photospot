import React, { useState, useContext } from "react";
import { View, StyleSheet, Text } from "react-native";
import { Button, TextInput } from "react-native-paper";
import { Context as AuthContext } from "../context/AuthContext";
import { NavigationEvents } from "react-navigation";

const SignupScreen = ({ navigation }) => {
  const { state, signUp, clearErrorMessage } = useContext(AuthContext);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
        value={password}
        onChangeText={(e) => setPassword(e)}
        secureTextEntry={true}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button onPress={() => signUp({ email, password })}>Sign Up</Button>
      <Button onPress={() => navigation.navigate("Signin")}>
        Already Registered? Sign in here
      </Button>
      {state.errorMessage ? (
        <Text style={styles.error}>{state.errorMessage}</Text>
      ) : null}
      <NavigationEvents onWillFocus={clearErrorMessage} />
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
  error: {
    fontSize: 15,
    color: "red",
    marginLeft: 15,
  },
});

SignupScreen.navigationOptions = () => {
  return {
    headerShown: false,
  };
};

export default SignupScreen;
