import React, { useState, useContext, useEffect } from "react";
import { View, StyleSheet, Text } from "react-native";
import { Button, TextInput } from "react-native-paper";
import { NavigationEvents } from "react-navigation";
import { Context as AuthContext } from "../context/AuthContext";

const SigninScreen = ({ navigation }) => {
  const { state, signIn, clearErrorMessage, tryLocalSignIn } = useContext(
    AuthContext
  );
  const [email, setUserName] = useState("");
  const [password, setUserPass] = useState("");

  useEffect(() => {
    tryLocalSignIn();
  }, []);

  return (
    <View style={styles.container}>
      <TextInput
        label="Email"
        value={email}
        onChangeText={(e) => setUserName(e)}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextInput
        style={styles.input}
        label="Password"
        value={password}
        onChangeText={(e) => setUserPass(e)}
        secureTextEntry={true}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button onPress={() => signIn({ email, password })}>Sign in</Button>
      <Button onPress={() => navigation.navigate("Signup")}>
        Not registered? Sign up
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
});

SigninScreen.navigationOptions = () => {
  return {
    headerShown: false,
  };
};

export default SigninScreen;
