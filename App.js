import { createAppContainer, createSwitchNavigator } from "react-navigation";
import { createStackNavigator } from "react-navigation-stack";
import { createBottomTabNavigator } from "react-navigation-tabs";
import AccountScreen from "./src/screens/AccountScreen";
import SigninScreen from "./src/screens/SigninScreen";
import SignupScreen from "./src/screens/SignupScreen";
import SpotCreateScreen from "./src/screens/SpotCreateScreen";
import SpotDetailScreen from "./src/screens/SpotDetailScreen";
import SpotListScreen from "./src/screens/SpotListScreen";

const switchNavigator = createSwitchNavigator({
  loginFlow: createStackNavigator({
    Signin: SigninScreen,
    SignUp: SignupScreen,
  }),
  mainFlow: createBottomTabNavigator({
    spotListFlow: createStackNavigator({
      SpotList: SpotListScreen,
      SpotDetail: SpotDetailScreen,
    }),
    Account: AccountScreen,
    SpotCreate: SpotCreateScreen,
  }),
});

export default createAppContainer(switchNavigator);
