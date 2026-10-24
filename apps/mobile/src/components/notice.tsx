import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, space, TOUCH, useTheme } from "@/lib/theme";

interface NoticeAction {
  label: string;
  run: () => void | Promise<void>;
}

interface Notice {
  id: number;
  message: string;
  action?: NoticeAction;
  tone: "info" | "error";
}

interface NoticeApi {
  /** Shows a message at the bottom; an action (usually Undo) stays reachable until it fades. */
  notify: (message: string, options?: { action?: NoticeAction; tone?: "info" | "error" }) => void;
}

const NoticeContext = createContext<NoticeApi | null>(null);
const DURATION_MS = 6000;

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const nextId = useRef(1);

  const notify = useCallback<NoticeApi["notify"]>((message, options) => {
    const id = nextId.current++;
    setNotice({ id, message, tone: options?.tone ?? "info", ...(options?.action ? { action: options.action } : {}) });
    setTimeout(() => setNotice((current) => (current?.id === id ? null : current)), DURATION_MS);
  }, []);

  const api = useMemo(() => ({ notify }), [notify]);
  const theme = useTheme();

  return (
    <NoticeContext value={api}>
      {children}
      {notice && (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.message, { color: notice.tone === "error" ? theme.danger : theme.text }]}>
            {notice.tone === "error" ? "⚠ " : ""}
            {notice.message}
          </Text>
          {notice.action && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void notice.action?.run();
                setNotice(null);
              }}
              style={styles.action}
            >
              <Text style={[styles.actionLabel, { color: theme["accent-strong"] }]}>{notice.action.label}</Text>
            </Pressable>
          )}
        </View>
      )}
    </NoticeContext>
  );
}

export function useNotice(): NoticeApi {
  const api = useContext(NoticeContext);
  if (!api) throw new Error("useNotice must be used inside NoticeProvider");
  return api;
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: space.md,
    right: space.md,
    bottom: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingLeft: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  message: { flex: 1, fontSize: 14, lineHeight: 20, paddingVertical: space.sm },
  action: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: space.md },
  actionLabel: { fontSize: 14, fontWeight: "600" },
});
