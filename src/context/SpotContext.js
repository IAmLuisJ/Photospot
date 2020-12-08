import createDataContext from "./createDataContext";
import spotServer from "../api/spotServer";

const spotReducer = (state, action) => {
  switch (action.type) {
    case "GET_SPOTS":
      return action.payload;
    default:
      return state;
  }
};

const createSpot = (dispatch) => {
  return async (name, locations) => {
    await spotServer.post("/tracks", { name, locations });
    dispatch({ type: "SAVE_SPOT" });
  };
};

const fetchSpots = (dispatch) => {
  return async () => {
    const response = await spotServer.get("/tracks");
    dispatch({ type: "GET_SPOTS", payload: response.data });
  };
};

export const { Provider, Context } = createDataContext(
  spotReducer,
  { fetchSpots, createSpot },
  []
);
