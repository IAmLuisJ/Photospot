import { LocationSubscriber } from "expo-location/build/LocationSubscribers";
import React, { useContext, useState } from "react";
import { Button, TextInput } from "react-native-paper";
import { Context as LocationContext } from "../context/LocationContext";
import useSaveSpot from "../hooks/useSaveSpot";

const TrackForm = () => {
  const { state, changeName, startRecording, stopRecording } = useContext(
    LocationContext
  );
  const [saveSpot] = useSaveSpot();

  return (
    <>
      <TextInput
        label="SpotName"
        value={state.name}
        onChangeText={changeName}
      />
      {state.recording ? (
        <Button onPress={stopRecording}>Stop Tracking</Button>
      ) : (
        <Button onPress={startRecording}>Start Tracking</Button>
      )}
      {!state.recording || state.locations.length ? (
        <Button onPress={saveSpot}>Save</Button>
      ) : null}
    </>
  );
};

export default TrackForm;
