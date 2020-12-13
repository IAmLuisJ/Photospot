import React, { useState, useContext } from "react";
import { View, StyleSheet } from "react-native";
import { Button, TextInput, Snackbar } from "react-native-paper";
import { NavigationEvents } from "react-navigation";
import RememberCheckbox from "../components/RememberCheckbox";
import { Context as AuthContext } from "../context/AuthContext";

const SigninScreen = ({ navigation }) => {
  const { state, signIn, clearErrorMessage } = useContext(AuthContext);
  const [email, setUserName] = useState("");
  const [password, setUserPass] = useState("");

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
      <RememberCheckbox />
      <Button
        style={styles.signInButton}
        mode="contained"
        onPress={() => signIn({ email, password })}
      >
        Sign in
      </Button>
      <Button onPress={() => navigation.navigate("Signup")}>
        Not registered? Sign up
      </Button>
      {state.errorMessage ? (
        <Snackbar visible={true}>{state.errorMessage}</Snackbar>
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
  signInButton: {
    margin: 20,
  },
  error: {
    alignSelf: "center",
    justifyContent: "center",
  },
});

SigninScreen.navigationOptions = () => {
  return {
    headerShown: false,
  };
};

export default SigninScreen;
