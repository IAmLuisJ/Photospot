import spotServer from "../api/spotServer";
import createDataContext from "./createDataContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { navigate } from "../components/navigationRef";

const authReducer = (state, action) => {
  switch (action.type) {
    case "ADD_ERROR":
      return { ...state, errorMessage: action.payload };
    case "SIGN_ON":
      return { ...state, jwt: action.payload };
    case "CLEAR_ERROR":
      return { ...state, errorMessage: "" };
    case "SIGN_OUT":
      return { ...state, jwt: null };
    default:
      return state;
  }
};

const tryLocalSignIn = (dispatch) => {
  return async () => {
    try {
      const localToken = await AsyncStorage.getItem("userToken");
      if (localToken) {
        dispatch({ type: "SIGN_ON", payload: localToken });
        navigate("mainFlow");
      } else {
        navigate("loginFlow");
      }
    } catch (e) {
      console.log(e);
    }
  };
};

const clearErrorMessage = (dispatch) => () => {
  dispatch({ type: "CLEAR_ERROR" });
};

const signUp = (dispatch) => {
  return async ({ email, password }) => {
    try {
      const response = await spotServer.post("/signup", { email, password });
      await AsyncStorage.setItem("userToken", response.data.token);
      dispatch({ type: "SIGN_ON", payload: response.data.token });
      navigate("mainFlow");
    } catch (err) {
      console.log(err);
      dispatch({ type: "ADD_ERROR", payload: "signup failed" });
    }
  };
};

const signIn = (dispatch) => {
  return async ({ email, password }) => {
    try {
      const response = await spotServer.post("/signin", { email, password });
      await AsyncStorage.setItem("userToken", response.data.token);
      dispatch({ type: "SIGN_ON", payload: response.data.token });
      console.log("sign in success");
      navigate("mainFlow");
    } catch (err) {
      console.log(err);
      dispatch({ type: "ADD_ERROR", payload: "signup failed" });
    }
  };
};

const signOut = (dispatch) => {
  return async () => {
    await AsyncStorage.removeItem("userToken");
    dispatch({ type: "SIGN_OUT" });
    navigate("loginFlow");
  };
};

export const { Provider, Context } = createDataContext(
  authReducer,
  { signIn, signOut, signUp, clearErrorMessage, tryLocalSignIn },
  { errorMessage: "", jwt: "" }
);
