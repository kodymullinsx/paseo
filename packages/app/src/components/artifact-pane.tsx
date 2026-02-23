import { useEffect, useMemo, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { WebView } from "react-native-webview";

import { Fonts } from "@/constants/theme";
import type { ArtifactItem, ArtifactType } from "@/types/artifacts";
import { buildLineDiff } from "@/utils/tool-call-parsers";

const TYPE_COLORS: Record<ArtifactType, string> = {
  code: "#f97316",
  diff: "#a855f7",
  react: "#3b82f6",
  html: "#22c55e",
  mermaid: "#eab308",
  svg: "#ec4899",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildWebViewHtml(type: ArtifactType, content: string): string {
  if (type === "html") {
    return content;
  }

  if (type === "svg") {
    return `<!doctype html><html><body style="margin:0;background:#fff">${content}</body></html>`;
  }

  if (type === "mermaid") {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <script>mermaid.initialize({ startOnLoad: true });</script>
  </head>
  <body style="margin:16px;background:#fff">
    <div class="mermaid">${escapeHtml(content)}</div>
  </body>
</html>`;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  </head>
  <body style="margin:0;background:#fff">
    <div id="root"></div>
    <script type="text/babel">
${content}
const rootEl = document.getElementById('root');
if (typeof App !== 'undefined') {
  ReactDOM.createRoot(rootEl).render(<App />);
} else if (typeof Component !== 'undefined') {
  ReactDOM.createRoot(rootEl).render(<Component />);
}
    </script>
  </body>
</html>`;
}

function DiffPreview({ content }: { content: string }) {
  const { theme } = useUnistyles();
  const [oldStr, newStr] = content.split("\x00|||EDIT|||\x00");
  const lines = buildLineDiff(oldStr ?? "", newStr ?? "");

  return (
    <ScrollView style={{ flex: 1 }}>
      {lines.map((line, index) => (
        <Text
          key={`${line.type}-${index}`}
          style={{
            fontFamily: Fonts.mono,
            fontSize: 12,
            color:
              line.type === "add"
                ? "#22c55e"
                : line.type === "remove"
                  ? "#ef4444"
                  : theme.colors.foregroundMuted,
            paddingHorizontal: 12,
            paddingVertical: 1,
            backgroundColor:
              line.type === "add"
                ? "rgba(34,197,94,0.08)"
                : line.type === "remove"
                  ? "rgba(239,68,68,0.08)"
                  : "transparent",
          }}
        >
          {line.content}
        </Text>
      ))}
    </ScrollView>
  );
}

interface ArtifactPaneProps {
  artifacts: ArtifactItem[];
}

export function ArtifactPane({ artifacts }: ArtifactPaneProps) {
  const { theme } = useUnistyles();
  const isMobile = Platform.OS !== "web";
  const latestId = artifacts[artifacts.length - 1]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(latestId);

  useEffect(() => {
    if (latestId) {
      setSelectedId(latestId);
    }
  }, [latestId]);

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? null,
    [artifacts, selectedId]
  );

  if (artifacts.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={[styles.emptyTitle, { color: theme.colors.foregroundMuted }]}>No artifacts yet</Text>
        <Text style={[styles.emptySubtitle, { color: theme.colors.foregroundMuted }]}>File writes, edits, and rendered code blocks will appear here</Text>
      </View>
    );
  }

  const listPanel = (
    <FlatList
      data={[...artifacts].reverse()}
      keyExtractor={(item) => item.id}
      style={[
        styles.list,
        { borderRightColor: theme.colors.border },
      ]}
      renderItem={({ item }) => (
        <Pressable
          style={[
            styles.card,
            { borderBottomColor: theme.colors.border },
            item.id === selectedId ? { backgroundColor: theme.colors.surface2 } : null,
          ]}
          onPress={() => setSelectedId(item.id)}
        >
          <View style={[styles.typeBadge, { backgroundColor: TYPE_COLORS[item.type] }]}>
            <Text style={styles.typeBadgeText}>{item.type.toUpperCase()}</Text>
          </View>
          <Text style={[styles.cardTitle, { color: theme.colors.foreground }]} numberOfLines={2}>
            {item.title}
          </Text>
        </Pressable>
      )}
    />
  );

  const previewContent = selected ? (
    selected.type === "diff" ? (
      <DiffPreview content={selected.content} />
    ) : selected.type === "code" ? (
      <ScrollView style={styles.codePreviewVertical}>
        <ScrollView horizontal contentContainerStyle={styles.codePreviewHorizontalContent}>
          <Text style={[styles.codeText, { color: theme.colors.foreground }]}>{selected.content}</Text>
        </ScrollView>
      </ScrollView>
    ) : (
      <WebView
        style={{ flex: 1 }}
        originWhitelist={["*"]}
        source={{ html: buildWebViewHtml(selected.type, selected.content) }}
        javaScriptEnabled
        domStorageEnabled={false}
      />
    )
  ) : (
    <View style={styles.emptyState}>
      <Text style={{ color: theme.colors.foregroundMuted }}>Select an artifact</Text>
    </View>
  );

  if (isMobile) {
    if (selectedId === null) {
      return <View style={styles.singlePaneContainer}>{listPanel}</View>;
    }

    return (
      <View style={styles.singlePaneContainer}>
        <Pressable
          style={[styles.mobileBack, { borderBottomColor: theme.colors.border }]}
          onPress={() => setSelectedId(null)}
        >
          <Text style={{ color: theme.colors.primary }}>All Artifacts</Text>
        </Pressable>
        <View style={styles.previewPane}>{previewContent}</View>
      </View>
    );
  }

  return (
    <View style={styles.desktopContainer}>
      <View style={[styles.selectorRail, { borderBottomColor: theme.colors.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.selectorRailContent}
        >
          {[...artifacts].reverse().map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setSelectedId(item.id)}
              style={[
                styles.selectorChip,
                item.id === selectedId ? { backgroundColor: theme.colors.surface2 } : null,
              ]}
            >
              <View style={[styles.selectorTypeDot, { backgroundColor: TYPE_COLORS[item.type] }]} />
              <Text
                style={[styles.selectorChipText, { color: theme.colors.foreground }]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={styles.previewPane}>{previewContent}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  emptyTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    marginBottom: theme.spacing[2],
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    lineHeight: 20,
  },
  desktopContainer: {
    flex: 1,
    minWidth: 0,
  },
  singlePaneContainer: {
    flex: 1,
    minWidth: 0,
  },
  list: {
    flex: 1,
    borderRightWidth: 1,
  },
  previewPane: {
    flex: 1,
    minWidth: 0,
  },
  codePreviewVertical: {
    flex: 1,
    minWidth: 0,
  },
  codePreviewHorizontalContent: {
    minWidth: "100%",
  },
  card: {
    padding: theme.spacing[3],
    borderBottomWidth: 1,
    gap: theme.spacing[1],
  },
  typeBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  typeBadgeText: {
    color: "#fff",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  cardTitle: {
    fontSize: theme.fontSize.xs,
    fontFamily: Fonts.mono,
  },
  codeText: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    padding: theme.spacing[4],
  },
  mobileBack: {
    padding: theme.spacing[3],
    borderBottomWidth: 1,
  },
  selectorRail: {
    borderBottomWidth: 1,
  },
  selectorRailContent: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  selectorChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    minWidth: 0,
    maxWidth: 220,
    flexShrink: 1,
  },
  selectorTypeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  selectorChipText: {
    fontSize: theme.fontSize.xs,
    fontFamily: Fonts.mono,
    minWidth: 0,
    flexShrink: 1,
  },
}));
