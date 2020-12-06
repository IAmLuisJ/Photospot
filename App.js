import React from "react";
import { View, Text } from "react-native";
import { createAppContainer, createSwitchNavigator } from "react-navigation";
import { Provider as PaperProvider } from "react-native-paper";
import { Provider as AuthProvider } from "./src/context/AuthContext";
import { createStackNavigator } from "react-navigation-stack";
import { createBottomTabNavigator } from "react-navigation-tabs";
import AccountScreen from "./src/screens/AccountScreen";
import SigninScreen from "./src/screens/SigninScreen";
import SignupScreen from "./src/screens/SignupScreen";
import SpotCreateScreen from "./src/screens/SpotCreateScreen";
import SpotDetailScreen from "./src/screens/SpotDetailScreen";
import SpotListScreen from "./src/screens/SpotListScreen";
import { setNavigator } from "./src/components/navigationRef";

const switchNavigator = createSwitchNavigator({
  loginFlow: createStackNavigator({
    Signin: SigninScreen,
    Signup: SignupScreen,
  }),
  mainFlow: createBottomTabNavigator({
    spotListFlow: createStackNavigator({
      SpotList: SpotListScreen,
      SpotDetail: SpotDetailScreen,
    }),
    SpotCreate: SpotCreateScreen,
    Account: AccountScreen,
  }),
});

const App = createAppContainer(switchNavigator);

export default () => {
  return (
    <PaperProvider>
      <AuthProvider>
        <App ref={(navigator) => setNavigator(navigator)} />
      </AuthProvider>
    </PaperProvider>
  );
};
