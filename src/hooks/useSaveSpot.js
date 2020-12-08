import { useContext } from "react";
import { Context as SpotContext } from "../context/SpotContext";
import { Context as LocationContext } from "../context/LocationContext";
import { navigate } from "../components/navigationRef";

export default () => {
  const { createSpot } = useContext(SpotContext);
  const {
    state: { name, locations },
    clearSpot,
  } = useContext(LocationContext);

  const saveSpot = async () => {
    await createSpot(name, locations);
    clearSpot();
    navigate("SpotList");
  };

  return [saveSpot];
};
