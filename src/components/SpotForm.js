import React, { useContext } from "react";
import { Button, TextInput } from "react-native-paper";
import { Context as LocationContext } from "../context/LocationContext";
import useSaveSpot from "../hooks/useSaveSpot";

const SpotForm = () => {
  const { state, changeName, changeDescription } = useContext(LocationContext);
  const [saveSpot] = useSaveSpot();

  return (
    <>
      <TextInput
        label="Spot Name"
        value={state.name}
        onChangeText={changeName}
      />
      <TextInput
        label="Description"
        value={state.description}
        onChangeText={changeDescription}
      />
      <Button mode="contained" onPress={saveSpot}>
        Save New Spot
      </Button>
    </>
  );
};

export default SpotForm;
