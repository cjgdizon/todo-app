import { inviteTokenFrom } from "@todo/core";
import { DataError, setActiveWorkspace, useAcceptInvite, useData } from "@todo/data";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

function messageFor(error: unknown): string {
  if (error instanceof DataError && /already a member/i.test(error.message)) {
    return "You are already a member of that workspace.";
  }
  return "That invite is not valid or has expired. Ask the person who sent it for a new one.";
}

/** Joining a workspace from an invite code or link someone sent you. */
export function JoinSection() {
  const theme = useTheme();
  const { notify } = useNotice();
  const { userId } = useData();
  const accept = useAcceptInvite();
  const [text, setText] = useState("");

  async function join() {
    const token = inviteTokenFrom(text);
    if (!token) {
      notify("That doesn't look like an invite code or link.", { tone: "error" });
      return;
    }
    try {
      const workspaceId = await accept.mutateAsync(token);
      setText("");
      setActiveWorkspace(userId, workspaceId);
      notify("You joined the workspace.");
    } catch (error) {
      notify(messageFor(error), { tone: "error" });
    }
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Join a workspace
      </Text>
      <TextInput
        accessibilityLabel="Invite code or link"
        placeholder="Paste an invite code or link"
        placeholderTextColor={theme["text-muted"]}
        value={text}
        onChangeText={setText}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.field, { color: theme.text, backgroundColor: theme["surface-subtle"], borderColor: theme.border }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !text.trim() || accept.isPending }}
        disabled={!text.trim() || accept.isPending}
        onPress={() => void join()}
        style={[styles.button, { backgroundColor: theme.accent, opacity: text.trim() && !accept.isPending ? 1 : 0.5 }]}
      >
        <Text style={{ color: theme["on-accent"], fontWeight: "600" }}>{accept.isPending ? "Joining…" : "Join workspace"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { fontSize: 18, fontWeight: "600" },
  field: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.md },
});
