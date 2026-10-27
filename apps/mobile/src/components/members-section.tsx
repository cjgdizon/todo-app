import {
  setActiveWorkspace,
  useCreateInvite,
  useData,
  useInvites,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useTransferWorkspace,
  type Member,
  type WorkspaceRole,
} from "@todo/data";
import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

type Assignable = Exclude<WorkspaceRole, "owner">;
const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };

/** Who is in this workspace, with leave/remove and, for admins, invite codes. */
export function MembersSection() {
  const theme = useTheme();
  const { userId } = useData();
  const members = useMembers().data ?? [];
  const me = members.find((member) => member.userId === userId);
  const isOwner = me?.role === "owner";
  const canManage = isOwner || me?.role === "admin";

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
        Members
      </Text>
      {members.map((member) => (
        <MemberRow key={member.userId} member={member} isMe={member.userId === userId} canManage={canManage} isOwner={isOwner} />
      ))}
      {canManage ? <Invites isOwner={isOwner} /> : null}
    </View>
  );
}

function MemberRow({ member, isMe, canManage, isOwner }: { member: Member; isMe: boolean; canManage: boolean; isOwner: boolean }) {
  const theme = useTheme();
  const { notify } = useNotice();
  const { userId } = useData();
  const remove = useRemoveMember();
  const transfer = useTransferWorkspace();
  const canRemove = canManage && member.role !== "owner" && !isMe;
  const canLeave = isMe && member.role !== "owner";

  function confirmMakeOwner() {
    Alert.alert(`Make ${member.displayName} the owner?`, "You will become an admin of this workspace.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Make owner",
        onPress: () =>
          transfer.mutate(member.userId, {
            onSuccess: () => notify(`${member.displayName} is now the owner.`),
            onError: () => notify("Couldn't hand over the workspace. Try again.", { tone: "error" }),
          }),
      },
    ]);
  }

  function confirmRemove() {
    const title = isMe ? "Leave this workspace?" : `Remove ${member.displayName}?`;
    const message = isMe ? "You will lose access to its tasks." : "They will lose access to this workspace.";
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: isMe ? "Leave" : "Remove",
        style: "destructive",
        onPress: () =>
          remove.mutate(member.userId, {
            onSuccess: () => isMe && setActiveWorkspace(userId, null),
            onError: () => notify(isMe ? "Couldn't leave the workspace." : "Couldn't remove that member.", { tone: "error" }),
          }),
      },
    ]);
  }

  return (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <Text style={{ color: theme.text, fontSize: 16, flex: 1 }}>
        {member.displayName}
        {isMe ? " (you)" : ""}
      </Text>
      <Text style={{ color: theme["text-muted"] }}>{ROLE_LABEL[member.role]}</Text>
      {isOwner && member.role !== "owner" && !isMe ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Make ${member.displayName} the owner`} onPress={confirmMakeOwner} style={styles.link}>
          <Text style={{ color: theme.accent }}>Make owner</Text>
        </Pressable>
      ) : null}
      {canRemove || canLeave ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isMe ? "Leave workspace" : `Remove ${member.displayName}`}
          onPress={confirmRemove}
          style={styles.link}
        >
          <Text style={{ color: theme.danger }}>{isMe ? "Leave" : "Remove"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Invites({ isOwner }: { isOwner: boolean }) {
  const theme = useTheme();
  const { notify } = useNotice();
  const invites = useInvites().data ?? [];
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [role, setRole] = useState<Assignable>("member");
  const [code, setCode] = useState<string | null>(null);

  async function onCreate() {
    setCode(null);
    try {
      setCode(await create.mutateAsync(role));
    } catch {
      notify("Couldn't create an invite. Check your connection and try again.", { tone: "error" });
    }
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.subheading, { color: theme["text-muted"] }]}>
        Invite people. A code works once, for 7 days. Send it only to the person you mean to invite.
      </Text>
      {isOwner ? (
        <View style={styles.chips}>
          {(["member", "admin"] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityLabel={`Invite as ${ROLE_LABEL[option]}`}
              accessibilityState={{ selected: role === option }}
              onPress={() => setRole(option)}
              style={[
                styles.chip,
                { borderColor: role === option ? theme.accent : theme.border, backgroundColor: role === option ? theme["accent-subtle"] : "transparent" },
              ]}
            >
              <Text style={{ color: theme.text, fontWeight: "600" }}>{ROLE_LABEL[option]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={create.isPending}
        onPress={() => void onCreate()}
        style={[styles.button, { backgroundColor: theme.accent, opacity: create.isPending ? 0.5 : 1 }]}
      >
        <Text style={{ color: theme["on-accent"], fontWeight: "600" }}>Create invite code</Text>
      </Pressable>

      {code ? (
        <View style={styles.section}>
          <Text style={{ color: theme["text-muted"] }}>Invite code (shown once)</Text>
          <Text selectable accessibilityLabel="Invite code" style={{ color: theme.text, fontSize: 14 }}>
            {code}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void Share.share({ message: `Join my workspace in Todo. Invite code: ${code}` })}
            style={styles.link}
          >
            <Text style={{ color: theme.accent, fontWeight: "600" }}>Share</Text>
          </Pressable>
        </View>
      ) : null}

      {invites.map((invite) => (
        <View key={invite.id} style={[styles.row, { borderColor: theme.border }]}>
          <Text style={{ color: theme.text, flex: 1 }}>
            {ROLE_LABEL[invite.role]}, expires {invite.expiresAt.toLocaleDateString()}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Revoke the ${ROLE_LABEL[invite.role].toLowerCase()} invite that expires ${invite.expiresAt.toLocaleDateString()}`}
            onPress={() => revoke.mutate(invite.id, { onError: () => notify("Couldn't revoke that invite.", { tone: "error" }) })}
            style={styles.link}
          >
            <Text style={{ color: theme.danger }}>Revoke</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  heading: { fontSize: 18, fontWeight: "600" },
  subheading: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  link: { minHeight: TOUCH, minWidth: TOUCH, justifyContent: "center", paddingHorizontal: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: TOUCH, minWidth: TOUCH, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.md },
});
