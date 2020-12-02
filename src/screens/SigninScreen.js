import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Button, TextInput } from "react-native-paper";

const SigninScreen = ({ navigation }) => {
  const [userName, setUserName] = useState("");
  const [userPass, setUserPass] = useState("");

  return (
    <View>
      <TextInput
        label="Email"
        value={userName}
        onChangeText={(e) => setUserName(e)}
        style={styles.input}
      />
      <TextInput
        style={styles.input}
        label="Password"
        value={userPass}
        onChangeText={(e) => setUserPass(e)}
        secureTextEntry={true}
      />
      <Button onPress={() => navigation.navigate("mainFlow")}>Sign in</Button>
      <Button onPress={() => navigation.navigate("Signup")}>
        Not registered? Sign up
      </Button>
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    margin: 15,
    padding: 5,
  },
});

export default SigninScreen;
