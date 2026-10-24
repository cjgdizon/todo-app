import { useMemo, useRef, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, Text, View } from "react-native";
import { space, useTheme } from "@/lib/theme";

const TRIGGER = 80;
const MAX = 120;

interface SwipeRowProps {
  children: ReactNode;
  /** Swipe right (the row moves right, revealing the left side). */
  rightLabel: string;
  onSwipeRight: () => void;
  /** Swipe left. */
  leftLabel: string;
  onSwipeLeft: () => void;
}

/**
 * A row with swipe actions. Swiping is only a shortcut: the same actions must be reachable
 * without the gesture (the row exposes them as accessibility actions).
 */
export function SwipeRow({ children, rightLabel, onSwipeRight, leftLabel, onSwipeLeft }: SwipeRowProps) {
  const theme = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  // The responder is created once, so it reads the latest handlers through a ref.
  const handlers = useRef({ onSwipeRight, onSwipeLeft });
  handlers.current = { onSwipeRight, onSwipeLeft };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_event, g) => x.setValue(Math.max(-MAX, Math.min(MAX, g.dx))),
        onPanResponderRelease: (_event, g) => {
          if (g.dx > TRIGGER) handlers.current.onSwipeRight();
          else if (g.dx < -TRIGGER) handlers.current.onSwipeLeft();
          Animated.timing(x, { toValue: 0, duration: 120, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => x.setValue(0),
      }),
    [x],
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.under, { backgroundColor: theme["accent-subtle"] }]} pointerEvents="none">
        <Text style={[styles.label, { color: theme["accent-strong"] }]}>{rightLabel}</Text>
        <Text style={[styles.label, { color: theme["accent-strong"] }]}>{leftLabel}</Text>
      </View>
      <Animated.View
        style={{ transform: [{ translateX: x }], backgroundColor: theme.bg }}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden" },
  under: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
  },
  label: { fontSize: 14, fontWeight: "600" },
});
