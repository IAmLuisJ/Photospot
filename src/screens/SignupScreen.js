import React, { useState } from "react";
import { View, Text } from "react-native";
import { Button, TextInput } from "react-native-paper";
import Spacer from "./components/Spacer";

const SignupScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [userPass, setUserPass] = useState("");

  const SignUpUser = () => {};

  return (
    <View>
      <Spacer>
        <TextInput
          label="Email"
          onChangeText={(e) => setEmail(e)}
          value={email}
        />
      </Spacer>
      <Spacer>
        <TextInput
          label="Password"
          value={userPass}
          onChangeText={(e) => setUserPass(e)}
          secureTextEntry={true}
        />
      </Spacer>
      <Button onPress={() => navigation.navigate("mainFlow")}>Sign Up</Button>
      <Button onPress={() => navigation.navigate("Signin")}>
        Already Registered? Sign in here
      </Button>
    </View>
  );
};

export default SignupScreen;
