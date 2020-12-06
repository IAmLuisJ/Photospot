import React, { useContext, useEffect } from "react";
import { Context as AuthContext } from "../context/AuthContext";

const LoadingScreen = () => {
  const { tryLocalSignIn } = useContext(AuthContext);
  useEffect(() => {
    tryLocalSignIn();
  }, []);

  return null;
};

export default LoadingScreen;
