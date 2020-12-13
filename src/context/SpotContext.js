import createDataContext from "./createDataContext";
import spotServer from "../api/spotServer";
import { navigate } from "../components/navigationRef";

const spotReducer = (state, action) => {
  switch (action.type) {
    case "FETCH_SPOTS":
      return action.payload;
    case "DELETE_SPOT":
      return state;
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
    dispatch({ type: "FETCH_SPOT", payload: response.data });
  };
};

const deleteSpot = (dispatch) => {
  return async (_id) => {
    try {
      console.log(_id);
      const response = await spotServer.delete("/spots", {
        _id: _id,
      });
      console.log(response);
      dispatch({ type: "DELETE_SPOT" });
      navigate("mainFlow");
    } catch (e) {
      console.log(err);
    }
  };
};

export const { Provider, Context } = createDataContext(
  spotReducer,
  { fetchSpots, createSpot, deleteSpot },
  []
);
