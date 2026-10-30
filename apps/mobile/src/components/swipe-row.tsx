import { useMemo, useRef, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from "react-native";
import { thresholdTick } from "@/lib/haptics";
import { space, useTheme } from "@/lib/theme";

/** The row follows the finger one to one up to this distance; releasing past it commits the action. */
const TRIGGER = 96;
/** Past the trigger the row resists: it moves this fraction of the extra distance. */
const RESISTANCE = 0.35;
const MAX = 140;

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
  const passed = useRef(false);
  // The responder is created once, so it reads the latest handlers through a ref.
  const handlers = useRef({ onSwipeRight, onSwipeLeft });
  handlers.current = { onSwipeRight, onSwipeLeft };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_event, g) => {
          const far = Math.abs(g.dx);
          const eased = far <= TRIGGER ? far : TRIGGER + (far - TRIGGER) * RESISTANCE;
          x.setValue(Math.sign(g.dx) * Math.min(MAX, eased));
          // One tick each time the swipe crosses the commit line.
          if (far >= TRIGGER && !passed.current) thresholdTick();
          passed.current = far >= TRIGGER;
        },
        onPanResponderRelease: (_event, g) => {
          if (g.dx > TRIGGER) handlers.current.onSwipeRight();
          else if (g.dx < -TRIGGER) handlers.current.onSwipeLeft();
          passed.current = false;
          Animated.timing(x, { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => {
          passed.current = false;
          x.setValue(0);
        },
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
