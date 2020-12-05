import spotServer from "../api/spotServer";
import createDataContext from "./createDataContext";

const authReducer = (state, action) => {
  switch (action.type) {
    case "ADD_ERROR":
      return { ...state, errorMessage: action.payload };
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
  return ({ email, password }) => {};
};

const signOut = (dispatch) => {
  return () => {
    //sign out
  };
};

export const { Provider, Context } = createDataContext(
  authReducer,
  { signIn, signOut, signUp },
  { isSignedIn: false, errorMessage: "" }
);
