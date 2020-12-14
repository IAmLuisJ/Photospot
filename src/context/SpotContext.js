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
  return async (name, description, location) => {
    try {
      await spotServer.post("/spots", { name, description, location });
    } catch (err) {
      console.log(err);
    }
  };
};

const fetchSpots = (dispatch) => {
  return async () => {
    const response = await spotServer.get("/spots");
    dispatch({ type: "FETCH_SPOTS", payload: response.data });
  };
};

const deleteSpot = (dispatch) => {
  return async (_id) => {
    try {
      const response = await spotServer.delete("/spots", {
        data: { _id },
      });
      dispatch({ type: "DELETE_SPOT" });
    } catch (e) {
      console.log(e);
    }
  };
};

export const { Provider, Context } = createDataContext(
  spotReducer,
  { fetchSpots, createSpot, deleteSpot },
  []
);
