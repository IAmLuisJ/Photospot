import { ActionSheetIOS } from "react-native";
import createDataContext from "./createDataContext";

const locationReducer = (state, action) => {
  switch (action.type) {
    case "ADD_CURRENT_LOCATION":
      return { ...state, currentLocation: action.payload };
    default:
      return state;
  }
};

const startRecording = (dispatch) => {
  return () => {};
};

const stopRecording = (dispatch) => {
  return () => {};
};

const addLocation = (dispatch) => {
  return (location) => {
    dispatch({ type: "ADD_CURRENT_LOCATION", payload: location });
  };
};

export const { Provider, Context } = createDataContext(
  locationReducer,
  { startRecording, stopRecording, addLocation },
  { recording: false, locations: [], currentLocation: null }
);
