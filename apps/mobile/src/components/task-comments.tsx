import { findMentions, splitMentions } from "@todo/core";
import {
  useAddComment,
  useComments,
  useData,
  useDeleteComment,
  useEditComment,
  useMembers,
  type Comment,
  type Member,
} from "@todo/data";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";
import { useNotice } from "./notice";

const MAX_COMMENT_LENGTH = 10_000;

/** Comments on one task, with @mentions highlighted. */
export function TaskComments({ taskId }: { taskId: string }) {
  const theme = useTheme();
  const { notify } = useNotice();
  const comments = useComments(taskId);
  const members = useMembers().data ?? [];
  const add = useAddComment(taskId);
  const [body, setBody] = useState("");
  const names = new Map(members.map((member) => [member.userId, member.displayName]));

  function post() {
    const text = body.trim();
    if (!text) return;
    setBody("");
    add.mutate(
      { id: crypto.randomUUID(), body: text, mentions: findMentions(text, members) },
      {
        onError: () => {
          setBody(text);
          notify("Couldn't post that comment. Try again.", { tone: "error" });
        },
      },
    );
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme["text-muted"] }]}>Comments</Text>
      {(comments.data ?? []).map((comment) => (
        <CommentItem key={comment.id} comment={comment} taskId={taskId} author={names.get(comment.authorId ?? "")} members={members} />
      ))}
      <TextInput
        accessibilityLabel="Add a comment"
        placeholder="Add a comment. Use @name to mention someone."
        placeholderTextColor={theme["text-muted"]}
        value={body}
        onChangeText={setBody}
        maxLength={MAX_COMMENT_LENGTH}
        multiline
        style={[styles.field, { color: theme.text, backgroundColor: theme["surface-subtle"], borderColor: theme.border }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Post comment"
        accessibilityState={{ disabled: !body.trim() }}
        disabled={!body.trim()}
        onPress={post}
        style={[styles.button, { backgroundColor: theme.accent, opacity: body.trim() ? 1 : 0.5 }]}
      >
        <Text style={{ color: theme["on-accent"], fontWeight: "600" }}>Post comment</Text>
      </Pressable>
    </View>
  );
}

function CommentItem({
  comment,
  taskId,
  author,
  members,
}: {
  comment: Comment;
  taskId: string;
  author: string | undefined;
  members: readonly Member[];
}) {
  const theme = useTheme();
  const { notify } = useNotice();
  const { userId } = useData();
  const edit = useEditComment(taskId);
  const remove = useDeleteComment(taskId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const mine = comment.authorId === userId;

  function save() {
    const text = draft.trim();
    if (!text) return;
    setEditing(false);
    if (text === comment.body) return;
    edit.mutate(
      { id: comment.id, body: text, mentions: findMentions(text, members) },
      { onError: () => notify("Couldn't save that edit.", { tone: "error" }) },
    );
  }

  return (
    <View style={[styles.item, { borderColor: theme.border }]}>
      <Text style={{ color: theme["text-muted"], fontSize: 13 }}>
        {mine ? "You" : (author ?? "Former member")}, {comment.createdAt.toLocaleString()}
        {comment.editedAt ? " (edited)" : ""}
      </Text>
      {editing ? (
        <>
          <TextInput
            accessibilityLabel="Edit comment"
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_COMMENT_LENGTH}
            multiline
            autoFocus
            style={[styles.field, { color: theme.text, backgroundColor: theme["surface-subtle"], borderColor: theme.border }]}
          />
          <View style={styles.row}>
            <Pressable accessibilityRole="button" onPress={() => { setDraft(comment.body); setEditing(false); }} style={styles.link}>
              <Text style={{ color: theme.text }}>Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={save} style={styles.link}>
              <Text style={{ color: theme.accent, fontWeight: "600" }}>Save</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text style={{ color: theme.text, fontSize: 16 }}>
          {splitMentions(comment.body, members).map((part, index) => (
            <Text key={index} style={part.userId ? { fontWeight: "700", color: theme.accent } : undefined}>
              {part.text}
            </Text>
          ))}
        </Text>
      )}
      {mine && !editing ? (
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit comment" onPress={() => { setDraft(comment.body); setEditing(true); }} style={styles.link}>
            <Text style={{ color: theme["text-muted"] }}>Edit</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete comment"
            onPress={() => remove.mutate(comment.id, { onError: () => notify("Couldn't delete that comment.", { tone: "error" }) })}
            style={styles.link}
          >
            <Text style={{ color: theme.danger }}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  label: { fontSize: 14, lineHeight: 20, marginTop: space.sm },
  item: { gap: 4, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  field: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 16 },
  button: { minHeight: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: space.md },
  row: { flexDirection: "row", gap: space.sm },
  link: { minHeight: TOUCH, minWidth: TOUCH, justifyContent: "center", paddingHorizontal: space.sm },
});
