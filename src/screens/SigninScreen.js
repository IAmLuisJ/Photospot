import React, { useState } from "react";
import { View, Text } from "react-native";
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
      />
      <TextInput
        label="Password"
        value={userPass}
        onChangeText={(e) => setUserPass(e)}
      />
      <Button>Sign in</Button>
      <Button onPress={() => navigation.navigate("Signup")}>
        Not registered? Sign up
      </Button>
    </View>
  );
};

export default SigninScreen;
