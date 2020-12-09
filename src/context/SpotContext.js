import createDataContext from "./createDataContext";
import spotServer from "../api/spotServer";

const spotReducer = (state, action) => {
  switch (action.type) {
    case "FETCH_SPOTS":
      return action.payload;
    default:
      return state;
  }
};

const createSpot = (dispatch) => {
  return async (name, locations) => {
    try {
      await spotServer.post("/tracks", { name, locations });
    } catch (err) {
      console.log(err);
    }
  };
};

const fetchSpots = (dispatch) => {
  return async () => {
    const response = await spotServer.get("/tracks");
    dispatch({ type: "FETCH_SPOTS", payload: response.data });
  };
};

export const { Provider, Context } = createDataContext(
  spotReducer,
  { fetchSpots, createSpot },
  []
);
