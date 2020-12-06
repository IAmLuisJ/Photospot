import React, { useContext, useEffect } from "react";
import { ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-navigation";
import { Context as AuthContext } from "../context/AuthContext";

const LoadingScreen = () => {
  const { tryLocalSignIn } = useContext(AuthContext);
  useEffect(() => {
    tryLocalSignIn();
  }, []);

  return (
    <SafeAreaView forceInset={{ top: "always" }}>
      <ActivityIndicator animating={true} />
    </SafeAreaView>
  );
};

export default LoadingScreen;
