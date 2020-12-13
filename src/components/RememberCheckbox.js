import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text, Checkbox } from "react-native-paper";

const RememberCheckbox = () => {
  const [checked, setChecked] = useState(true);
  return (
    <View style={styles.checkStyle}>
      <Text>Remember Me</Text>
      <View style={styles.checkBoxStyle}>
        <Checkbox
          style={styles.checkBoxStyle}
          status={checked ? "checked" : "unchecked"}
          onPress={() => setChecked(!checked)}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  checkStyle: {
    margin: 20,
    padding: 5,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
  },
  checkBoxStyle: {
    borderWidth: 1,
    borderColor: "black",
    marginLeft: 10,
  },
});

export default RememberCheckbox;
