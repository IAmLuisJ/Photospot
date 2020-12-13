import createDataContext from "./createDataContext";

const locationReducer = (state, action) => {
  switch (action.type) {
    case "ADD_CURRENT_LOCATION":
      return {
        ...state,
        currentLocation: action.payload,
      };
    case "SET_CURRENT_LOCATION":
      return { ...state, location: action.payload };
    case "START_RECORDING":
      return { ...state, recording: true };
    case "STOP_RECORDING":
      return { ...state, recording: false };
    case "ADD_LOCATION":
      return { ...state, locations: [...state.locations, action.payload] };
    case "CHANGE_NAME":
      return { ...state, name: action.payload };
    case "CHANGE_DESCRIPTION":
      return { ...state, description: action.payload };
    case "RESET":
      return {
        ...state,
        name: "",
        locations: [],
        description: "",
        location: null,
      };
    default:
      return state;
  }
};

const changeName = (dispatch) => {
  return (name) => {
    dispatch({ type: "CHANGE_NAME", payload: name });
  };
};

const changeDescription = (dispatch) => {
  return (description) => {
    dispatch({ type: "CHANGE_DESCRIPTION", payload: description });
  };
};

const startRecording = (dispatch) => {
  return () => {
    dispatch({ type: "START_RECORDING" });
  };
};

const stopRecording = (dispatch) => {
  return () => {
    dispatch({ type: "STOP_RECORDING" });
  };
};

const addLocation = (dispatch) => {
  return (location, recording) => {
    dispatch({ type: "ADD_CURRENT_LOCATION", payload: location });
    dispatch({ type: "SET_CURRENT_LOCATION", payload: location });
    if (recording) {
      dispatch({ type: "ADD_LOCATION", payload: location });
    }
  };
};

const clearSpot = (dispatch) => {
  return () => {
    dispatch({ type: "RESET" });
  };
};

export const { Provider, Context } = createDataContext(
  locationReducer,
  {
    startRecording,
    stopRecording,
    addLocation,
    changeName,
    changeDescription,
    clearSpot,
  },
  {
    recording: false,
    locations: [],
    currentLocation: null,
    name: "",
    description: "",
    location: null,
  }
);
