import React, { useState } from "react";
import { View, Text } from "react-native";
import { Button, TextInput } from "react-native-paper";

const SignupScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [userPass, setUserPass] = useState("");

  return (
    <View>
      <TextInput
        label="Email"
        onChangeText={(e) => setEmail(e)}
        value={email}
      />
      <TextInput
        label="Password"
        value={userPass}
        onChangeText={(e) => setUserPass(e)}
      />
      <Button>Sign Up</Button>
      <Button onPress={() => navigation.navigate("Signin")}>
        Already Registered? Sign in here
      </Button>
    </View>
  );
};

export default SignupScreen;
