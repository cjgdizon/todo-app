import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getBackend } from "@/lib/supabase";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";

export default function SignIn() {
  const theme = useTheme();
  const { client } = getBackend();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const credentials = { email: email.trim(), password };
    const { data, error } =
      mode === "in" ? await client.auth.signInWithPassword(credentials) : await client.auth.signUp(credentials);
    setBusy(false);
    if (error) setMessage(error.message);
    // With email confirmation on, sign-up succeeds without a session until the link is opened.
    else if (mode === "up" && !data.session) setMessage("Check your email to confirm your account, then sign in.");
    // Otherwise the session listener takes the user to the app.
  }

  const input = [styles.input, { color: theme.text, backgroundColor: theme["surface-subtle"], borderColor: theme.border }];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { backgroundColor: theme.bg }]}
    >
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        {mode === "in" ? "Sign in" : "Create an account"}
      </Text>
      <TextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
        style={input}
      />
      <TextInput
        accessibilityLabel="Password"
        autoCapitalize="none"
        autoComplete={mode === "in" ? "current-password" : "new-password"}
        secureTextEntry
        textContentType={mode === "in" ? "password" : "newPassword"}
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
        style={input}
      />
      {message && (
        <Text accessibilityRole="alert" style={{ color: theme.danger }}>
          {message}
        </Text>
      )}
      <Pressable
        testID="sign-in-submit"
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || !email || !password, busy }}
        disabled={busy || !email || !password}
        onPress={() => void submit()}
        style={[styles.button, { backgroundColor: theme.accent, opacity: busy || !email || !password ? 0.5 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator color={theme["on-accent"]} />
        ) : (
          <Text style={[styles.buttonLabel, { color: theme["on-accent"] }]}>
            {mode === "in" ? "Sign in" : "Create your account"}
          </Text>
        )}
      </Pressable>
      <View style={styles.switch}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setMode(mode === "in" ? "up" : "in");
            setMessage(null);
          }}
          style={styles.switchButton}
        >
          <Text style={{ color: theme["accent-strong"], fontWeight: "600" }}>
            {mode === "in" ? "Create an account" : "I already have an account"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", padding: space.lg, gap: space.md },
  heading: { fontSize: 28, lineHeight: 36, fontWeight: "600" },
  input: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, fontSize: 16 },
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  switch: { alignItems: "center" },
  switchButton: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.md },
});
