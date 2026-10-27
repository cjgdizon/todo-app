import { DataError, DELETE_ACCOUNT_CONFIRMATION, setActiveWorkspace, useData, useDeleteAccount, useDeletionBlockers } from "@todo/data";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

/** Permanently deleting the account, with what goes and what stays spelled out first. */
export function AccountSection() {
  const theme = useTheme();
  const { notify } = useNotice();
  const { client, userId } = useData();
  const blockers = useDeletionBlockers().data ?? [];
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState("");
  const ready = typed === DELETE_ACCOUNT_CONFIRMATION && !remove.isPending;

  async function run() {
    try {
      await remove.mutateAsync(typed);
      // The login is gone; signing out lets the app clear what it saved on this phone.
      await client.auth.signOut({ scope: "local" });
    } catch (error) {
      notify(error instanceof DataError ? error.message : "Couldn't delete your account. Check your connection and try again.", { tone: "error" });
    }
  }

  function confirm() {
    Alert.alert("Delete your account?", "This is permanent and cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete my account", style: "destructive", onPress: () => void run() },
    ]);
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.danger }]}>
        Delete account
      </Text>
      <Text style={{ color: theme["text-muted"] }}>
        This permanently deletes your account, your private workspaces with their tasks and files, and your connection to Google
        Calendar. Work in workspaces shared with other people stays, without your name on it.
      </Text>
      {blockers.length > 0 ? (
        <>
          <Text style={{ color: theme.text }}>
            You own workspaces that other people use. Hand each one to another member first: switch to it, then use &ldquo;Make
            owner&rdquo; in Members above.
          </Text>
          {blockers.map((workspace) => (
            <Pressable
              key={workspace.workspaceId}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${workspace.name}`}
              onPress={() => setActiveWorkspace(userId, workspace.workspaceId)}
              style={styles.link}
            >
              <Text style={{ color: theme.accent, fontWeight: "600" }}>
                {workspace.name} ({workspace.memberCount} members)
              </Text>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <TextInput
            accessibilityLabel={`Type ${DELETE_ACCOUNT_CONFIRMATION} to confirm`}
            placeholder={`Type "${DELETE_ACCOUNT_CONFIRMATION}"`}
            placeholderTextColor={theme["text-muted"]}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.field, { color: theme.text, backgroundColor: theme["surface-subtle"], borderColor: theme.border }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
            disabled={!ready}
            onPress={confirm}
            style={[styles.button, { backgroundColor: theme.danger, opacity: ready ? 1 : 0.5 }]}
          >
            <Text style={{ color: theme["on-accent"], fontWeight: "600" }}>{remove.isPending ? "Deleting…" : "Delete my account"}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { fontSize: 18, fontWeight: "600" },
  link: { minHeight: TOUCH, justifyContent: "center", alignSelf: "flex-start" },
  field: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.md },
});
