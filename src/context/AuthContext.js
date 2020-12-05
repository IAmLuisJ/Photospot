import spotServer from "../api/spotServer";
import createDataContext from "./createDataContext";

const authReducer = (state, action) => {
  switch (action.type) {
    case "ADD_ERROR":
      return { ...state, errorMessage: action.payload };
    case "SIGN_ON":
      return { ...state, jwt: action.payload };
    case "SIGNED":
      return { ...state, isSignedIn: true };
    default:
      return state;
  }
};

const signUp = (dispatch) => {
  return async ({ email, password }) => {
    try {
      const response = await spotServer.post("/signup", { email, password });
    } catch (err) {
      console.log(err);
      dispatch({ type: "ADD_ERROR", payload: "signup failed" });
    }
  };
};

const signIn = (dispatch) => {
  return async ({ email, password }) => {
    try {
      const response = await spotServer.post("signin", { email, password });
      dispatch({ type: "SIGN_ON", payload: response.data.token });
      dispatch({ type: "SIGNED" });
    } catch (err) {
      console.log(err);
    }
  };
};

const signOut = (dispatch) => {
  return () => {
    //sign out
  };
};

export const { Provider, Context } = createDataContext(
  authReducer,
  { signIn, signOut, signUp },
  { isSignedIn: false, errorMessage: "", jwt: "" }
);
