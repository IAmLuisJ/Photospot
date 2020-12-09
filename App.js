import React from "react";
import { createAppContainer, createSwitchNavigator } from "react-navigation";
import { Provider as PaperProvider } from "react-native-paper";
import { Provider as AuthProvider } from "./src/context/AuthContext";
import { Provider as LocationProvider } from "./src/context/LocationContext";
import { Provider as SpotProvider } from "./src/context/SpotContext";
import { createStackNavigator } from "react-navigation-stack";
import { createBottomTabNavigator } from "react-navigation-tabs";
import AccountScreen from "./src/screens/AccountScreen";
import SigninScreen from "./src/screens/SigninScreen";
import SignupScreen from "./src/screens/SignupScreen";
import SpotCreateScreen from "./src/screens/SpotCreateScreen";
import SpotDetailScreen from "./src/screens/SpotDetailScreen";
import SpotListScreen from "./src/screens/SpotListScreen";
import LoadingScreen from "./src/screens/LoadingScreen";
import { setNavigator } from "./src/components/navigationRef";
import { FontAwesome } from "@expo/vector-icons";

const spotListFlow = createStackNavigator({
  SpotList: SpotListScreen,
  SpotDetail: SpotDetailScreen,
});

spotListFlow.navigationOptions = () => {
  return {
    title: "Spot List",
    tabBarIcon: <FontAwesome name="list" size={20} />,
  };
};

const switchNavigator = createSwitchNavigator({
  loading: LoadingScreen,
  loginFlow: createStackNavigator({
    Signin: SigninScreen,
    Signup: SignupScreen,
  }),
  mainFlow: createBottomTabNavigator({
    spotListFlow: spotListFlow,
    SpotCreate: SpotCreateScreen,
    Account: AccountScreen,
  }),
});

const App = createAppContainer(switchNavigator);

export default () => {
  return (
    <PaperProvider>
      <SpotProvider>
        <AuthProvider>
          <LocationProvider>
            <App
              ref={(navigator) => {
                setNavigator(navigator);
              }}
            />
          </LocationProvider>
        </AuthProvider>
      </SpotProvider>
    </PaperProvider>
  );
};
