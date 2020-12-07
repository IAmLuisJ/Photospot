import { useState, useEffect } from "react";
import {
  Accuracy,
  requestPermissionsAsync,
  watchPositionAsync,
} from "expo-location";

export default (callback) => {
  const [err, setlocationError] = useState("");

  const startWatchingLocation = async () => {
    try {
      const { granted } = await requestPermissionsAsync();
      if (!granted) {
        throw new Error("Permission not granted");
      }
      const subscriber = await watchPositionAsync(
        {
          accuracy: Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 10,
        },
        callback
      );
    } catch (err) {
      setlocationError(err);
    }
  };

  useEffect(() => {
    startWatchingLocation();
  }, []);
  return [err];
};
