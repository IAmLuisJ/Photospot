import { ActionSheetIOS } from "react-native";
import createDataContext from "./createDataContext";

const locationReducer = (state, action) => {
  switch (action.type) {
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
  return () => {};
};

export const { Provider, Context } = createDataContext(
  locationReducer,
  { startRecording, stopRecording, addLocation },
  { recording: false, locations: [], currentLocation: null }
);
