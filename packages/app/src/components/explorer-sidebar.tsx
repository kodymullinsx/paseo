import { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, UnistylesRuntime, useUnistyles } from "react-native-unistyles";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { X } from "lucide-react-native";
import {
  usePanelStore,
  MIN_EXPLORER_SIDEBAR_WIDTH,
  MAX_EXPLORER_SIDEBAR_WIDTH,
} from "@/stores/panel-store";
import { useExplorerSidebarAnimation } from "@/contexts/explorer-sidebar-animation-context";
import { HEADER_INNER_HEIGHT } from "@/constants/layout";
import { useSessionStore, selectAgentArtifacts } from "@/stores/session-store";
import { ArtifactPane } from "./artifact-pane";

const MIN_CHAT_WIDTH = 480;
const IOS_KEYBOARD_INSET_MIN_HEIGHT = 120;
const DESKTOP_LEFT_SIDEBAR_WIDTH = 320;
const IS_DEV = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);

function logExplorerSidebar(event: string, details: Record<string, unknown>): void {
  if (!IS_DEV) {
    return;
  }
  console.log(`[ExplorerSidebar] ${event}`, details);
}

function resolveKeyboardShift(rawHeight: number, inset: number): number {
  "worklet";
  // iOS can report a small accessory/prediction bar height during touch focus.
  // Treat that as non-keyboard so terminal scroll gestures don't "bounce" the layout.
  if (Platform.OS === "ios" && rawHeight < IOS_KEYBOARD_INSET_MIN_HEIGHT) {
    return 0;
  }
  return Math.max(0, rawHeight - inset);
}

interface ExplorerSidebarProps {
  serverId: string;
  agentId: string;
  cwd: string;
  isGit: boolean;
}

export function ExplorerSidebar({ serverId, agentId, cwd: _cwd, isGit: _isGit }: ExplorerSidebarProps) {
  const insets = useSafeAreaInsets();
  const isMobile =
    UnistylesRuntime.breakpoint === "xs" || UnistylesRuntime.breakpoint === "sm";
  const mobileView = usePanelStore((state) => state.mobileView);
  const desktopFileExplorerOpen = usePanelStore((state) => state.desktop.fileExplorerOpen);
  const desktopAgentListOpen = usePanelStore((state) => state.desktop.agentListOpen);
  const closeToAgent = usePanelStore((state) => state.closeToAgent);
  const explorerWidth = usePanelStore((state) => state.explorerWidth);
  const setExplorerWidth = usePanelStore((state) => state.setExplorerWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = useSharedValue(insets.bottom);
  const closeTouchStartX = useSharedValue(0);
  const closeTouchStartY = useSharedValue(0);

  useEffect(() => {
    bottomInset.value = insets.bottom;
  }, [bottomInset, insets.bottom]);

  useEffect(() => {
    if (isMobile) {
      return;
    }
    const availableViewportWidth =
      viewportWidth - (desktopAgentListOpen ? DESKTOP_LEFT_SIDEBAR_WIDTH : 0);
    const maxWidth = Math.max(
      MIN_EXPLORER_SIDEBAR_WIDTH,
      Math.min(MAX_EXPLORER_SIDEBAR_WIDTH, availableViewportWidth - MIN_CHAT_WIDTH)
    );
    if (explorerWidth > maxWidth) {
      setExplorerWidth(maxWidth);
    }
  }, [desktopAgentListOpen, explorerWidth, isMobile, setExplorerWidth, viewportWidth]);

  // Derive isOpen from the unified panel state
  const isOpen = isMobile ? mobileView === "file-explorer" : desktopFileExplorerOpen;

  const {
    translateX,
    backdropOpacity,
    windowWidth,
    animateToOpen,
    animateToClose,
    isGesturing,
    closeGestureRef,
  } = useExplorerSidebarAnimation();

  // For resize drag, track the starting width
  const startWidthRef = useRef(explorerWidth);
  const resizeWidth = useSharedValue(explorerWidth);

  const handleClose = useCallback(
    (reason: string) => {
      logExplorerSidebar("handleClose", {
        reason,
        isOpen,
        mobileView,
        desktopFileExplorerOpen,
      });
      closeToAgent();
    },
    [closeToAgent, desktopFileExplorerOpen, isOpen, mobileView]
  );

  const enableSidebarCloseGesture = isMobile && isOpen;

  // Swipe gesture to close (swipe right on mobile)
  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(closeGestureRef)
        .enabled(enableSidebarCloseGesture)
        // Use manual activation so child views (e.g. WebView terminals) keep touch streams
        // unless we detect an intentional right-swipe close.
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }
          closeTouchStartX.value = touch.absoluteX;
          closeTouchStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, stateManager) => {
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }

          const deltaX = touch.absoluteX - closeTouchStartX.value;
          const deltaY = touch.absoluteY - closeTouchStartY.value;
          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);

          // Fail quickly on clear leftward or vertical intent so child views keep control.
          if (deltaX <= -10) {
            stateManager.fail();
            return;
          }
          if (absDeltaY > 10 && absDeltaY > absDeltaX) {
            stateManager.fail();
            return;
          }

          // Activate only on intentional rightward movement.
          if (deltaX >= 15 && absDeltaX > absDeltaY) {
            stateManager.activate();
          }
        })
        .onStart(() => {
          isGesturing.value = true;
        })
        .onUpdate((event) => {
          // Right sidebar: swipe right to close (positive translationX)
          const newTranslateX = Math.max(0, Math.min(windowWidth, event.translationX));
          translateX.value = newTranslateX;
          const progress = 1 - newTranslateX / windowWidth;
          backdropOpacity.value = Math.max(0, Math.min(1, progress));
        })
        .onEnd((event) => {
          isGesturing.value = false;
          const shouldClose =
            event.translationX > windowWidth / 3 || event.velocityX > 500;
          runOnJS(logExplorerSidebar)("closeGestureEnd", {
            translationX: event.translationX,
            velocityX: event.velocityX,
            shouldClose,
            windowWidth,
          });
          if (shouldClose) {
            animateToClose();
            runOnJS(handleClose)("swipe-close-gesture");
          } else {
            animateToOpen();
          }
        })
        .onFinalize(() => {
          isGesturing.value = false;
        }),
    [
      enableSidebarCloseGesture,
      windowWidth,
      translateX,
      backdropOpacity,
      animateToOpen,
      animateToClose,
      handleClose,
      isGesturing,
      closeGestureRef,
      closeTouchStartX,
      closeTouchStartY,
    ]
  );

  // Desktop resize gesture (drag left edge)
  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isMobile)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = explorerWidth;
          resizeWidth.value = explorerWidth;
        })
        .onUpdate((event) => {
          // Dragging left (negative translationX) increases width
          const newWidth = startWidthRef.current - event.translationX;
          const availableViewportWidth =
            viewportWidth - (desktopAgentListOpen ? DESKTOP_LEFT_SIDEBAR_WIDTH : 0);
          const maxWidth = Math.max(
            MIN_EXPLORER_SIDEBAR_WIDTH,
            Math.min(MAX_EXPLORER_SIDEBAR_WIDTH, availableViewportWidth - MIN_CHAT_WIDTH)
          );
          const clampedWidth = Math.max(
            MIN_EXPLORER_SIDEBAR_WIDTH,
            Math.min(maxWidth, newWidth)
          );
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setExplorerWidth)(resizeWidth.value);
        }),
    [desktopAgentListOpen, isMobile, explorerWidth, resizeWidth, setExplorerWidth, viewportWidth]
  );

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0.01 ? "auto" : "none",
  }));

  const mobileKeyboardInsetStyle = useAnimatedStyle(() => {
    const absoluteHeight = Math.abs(keyboardHeight.value);
    const shift = resolveKeyboardShift(absoluteHeight, bottomInset.value);
    return {
      paddingBottom: bottomInset.value + shift,
    };
  });

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  // Mobile: full-screen overlay with gesture.
  // On web, keep it interactive only while open so closed sidebars don't eat taps.
  const overlayPointerEvents = Platform.OS === "web" ? (isOpen ? "auto" : "none") : "box-none";

  if (isMobile) {
    return (
      <View style={StyleSheet.absoluteFillObject} pointerEvents={overlayPointerEvents}>
        {/* Backdrop */}
        <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
          <Pressable
            style={styles.backdropPressable}
            onPress={() => handleClose("backdrop-press")}
          />
        </Animated.View>

        <GestureDetector gesture={closeGesture} touchAction="pan-y">
          <Animated.View
            style={[
              styles.mobileSidebar,
              { width: windowWidth, paddingTop: insets.top },
              sidebarAnimatedStyle,
              mobileKeyboardInsetStyle,
            ]}
            pointerEvents="auto"
          >
            <SidebarContent
              onClose={() => handleClose("header-close-button")}
              serverId={serverId}
              agentId={agentId}
              isMobile={isMobile}
            />
          </Animated.View>
        </GestureDetector>
      </View>
    );
  }

  // Desktop: fixed width sidebar with resize handle
  if (!isOpen) {
    return null;
  }

  return (
    <Animated.View style={[styles.desktopSidebar, resizeAnimatedStyle]}>
      {/* Resize handle - absolutely positioned over left border */}
      <GestureDetector gesture={resizeGesture}>
        <View
          style={[
            styles.resizeHandle,
            Platform.OS === "web" && ({ cursor: "col-resize" } as any),
          ]}
        />
      </GestureDetector>

      <SidebarContent
        onClose={() => handleClose("desktop-close-button")}
        serverId={serverId}
        agentId={agentId}
        isMobile={false}
      />
    </Animated.View>
  );
}

interface SidebarContentProps {
  onClose: () => void;
  serverId: string;
  agentId: string;
  isMobile: boolean;
}

function SidebarContent({
  onClose,
  serverId,
  agentId,
  isMobile,
}: SidebarContentProps) {
  const { theme } = useUnistyles();
  const artifacts = useSessionStore((state) =>
    selectAgentArtifacts(state, serverId, agentId)
  );

  return (
    <View style={styles.sidebarContent} pointerEvents="auto">
      <View style={styles.header} testID="explorer-header">
        <Text style={[styles.headerTitle, { color: theme.colors.foreground }]}>
          Artifacts
        </Text>
        <View style={styles.headerRightSection}>
          {isMobile && (
            <Pressable onPress={onClose} style={styles.closeButton}>
              <X size={18} color={theme.colors.foregroundMuted} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.contentArea} testID="explorer-content-area">
        <ArtifactPane artifacts={artifacts} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  backdropPressable: {
    flex: 1,
  },
  mobileSidebar: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  desktopSidebar: {
    position: "relative",
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  resizeHandle: {
    position: "absolute",
    left: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  header: {
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    paddingHorizontal: theme.spacing[2],
  },
  headerRightSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  closeButton: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  contentArea: {
    flex: 1,
    minHeight: 0,
  },
}));
