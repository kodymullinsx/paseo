import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime, useUnistyles } from "react-native-unistyles";
import { Link2 } from "lucide-react-native";
import { MANAGED_DIRECT_ENDPOINT, useDaemonRegistry, type HostProfile } from "@/contexts/daemon-registry-context";
import { DaemonConnectionTestError, probeConnection } from "@/utils/test-daemon-connection";
import { AdaptiveModalSheet } from "./adaptive-modal-sheet";
import { Button } from "@/components/ui/button";

const styles = StyleSheet.create((theme) => ({
  field: {
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  helper: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));

function normalizeTransportMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  return trimmed;
}

function formatTechnicalTransportDetails(details: Array<string | null>): string | null {
  const unique = Array.from(
    new Set(
      details
        .map((value) => normalizeTransportMessage(value))
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );

  if (unique.length === 0) return null;

  const allGeneric = unique.every((value) => {
    const lower = value.toLowerCase();
    return lower === "transport error" || lower === "transport closed";
  });

  if (allGeneric) {
    return `${unique[0]} (no additional details provided)`;
  }

  return unique.join(" — ");
}

function buildConnectionFailureCopy(endpoint: string, error: unknown): { title: string; detail: string | null; raw: string | null } {
  const title = `We failed to connect to ${endpoint}.`;

  const raw = (() => {
    if (error instanceof DaemonConnectionTestError) {
      return (
        formatTechnicalTransportDetails([error.reason, error.lastError]) ??
        normalizeTransportMessage(error.message)
      );
    }
    if (error instanceof Error) {
      return normalizeTransportMessage(error.message);
    }
    return null;
  })();

  const rawLower = raw?.toLowerCase() ?? "";
  let detail: string | null = null;

  if (rawLower.includes("timed out")) {
    detail = "Connection timed out. Check the host/port and your network.";
  } else if (
    rawLower.includes("econnrefused") ||
    rawLower.includes("connection refused") ||
    rawLower.includes("err_connection_refused")
  ) {
    detail = "Connection was refused. Is the daemon running on that host and port?";
  } else if (rawLower.includes("enotfound") || rawLower.includes("not found")) {
    detail = "Host not found. Check the hostname and try again.";
  } else if (rawLower.includes("ehostunreach") || rawLower.includes("host is unreachable")) {
    detail = "Host is unreachable. Check your network and firewall.";
  } else if (rawLower.includes("certificate") || rawLower.includes("tls") || rawLower.includes("ssl")) {
    detail = "TLS/certificate error. This app expects a daemon reachable over the local network or via relay.";
  } else if (raw) {
    detail = "Unable to connect. Check the host/port and that the daemon is reachable.";
  } else {
    detail = "Unable to connect. Check the host/port and that the daemon is reachable.";
  }

  return { title, detail, raw };
}

export interface AddHostModalProps {
  visible: boolean;
  onClose: () => void;
  targetServerId?: string;
  onCancel?: () => void;
  onSaved?: (result: { profile: HostProfile; serverId: string; hostname: string | null; isNewHost: boolean }) => void;
}

export function AddHostModal({ visible, onClose, onCancel, onSaved, targetServerId }: AddHostModalProps) {
  const { theme } = useUnistyles();
  const { daemons, upsertDirectConnection } = useDaemonRegistry();
  const isMobile =
    UnistylesRuntime.breakpoint === "xs" || UnistylesRuntime.breakpoint === "sm";
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setErrorMessage("");
    onClose();
  }, [isSaving, onClose]);

  const handleCancel = useCallback(() => {
    if (isSaving) return;
    setErrorMessage("");
    (onCancel ?? onClose)();
  }, [isSaving, onCancel, onClose]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    const endpoint = MANAGED_DIRECT_ENDPOINT;

    try {
      setIsSaving(true);
      setErrorMessage("");

      const { serverId, hostname } = await probeConnection({ id: "probe", type: "direct", endpoint });
      if (targetServerId && serverId !== targetServerId) {
        const message = `That endpoint belongs to ${serverId}, not ${targetServerId}.`;
        setErrorMessage(message);
        if (!isMobile) {
          Alert.alert("Wrong daemon", message);
        }
        return;
      }

      const isNewHost = !daemons.some((daemon) => daemon.serverId === serverId);
      const profile = await upsertDirectConnection({
        serverId,
        endpoint,
      });

      onSaved?.({ profile, serverId, hostname, isNewHost });
      handleClose();
    } catch (error) {
      const { title, detail, raw } = buildConnectionFailureCopy(endpoint, error);
      const combined =
        raw && detail && raw !== detail
          ? `${title}\n${detail}\nDetails: ${raw}`
          : detail
            ? `${title}\n${detail}`
            : title;
      setErrorMessage(combined);
      if (!isMobile) {
        // Desktop/web: also surface it as a dialog for quick visibility.
        Alert.alert("Connection failed", combined);
      }
    } finally {
      setIsSaving(false);
    }
  }, [daemons, handleClose, isMobile, isSaving, onSaved, targetServerId, upsertDirectConnection]);

  useEffect(() => {
    if (!visible || isSaving || errorMessage) return;
    void handleSave();
  }, [errorMessage, handleSave, isSaving, visible]);

  return (
    <AdaptiveModalSheet title="Direct connection" visible={visible} onClose={handleClose} testID="add-host-modal">
      <Text style={styles.helper}>Using configured endpoint: {MANAGED_DIRECT_ENDPOINT}</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Host</Text>
        <Text style={styles.helper}>{MANAGED_DIRECT_ENDPOINT}</Text>
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button style={{ flex: 1 }} variant="secondary" onPress={handleCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          style={{ flex: 1 }}
          variant="default"
          onPress={() => void handleSave()}
          disabled={isSaving}
          leftIcon={<Link2 size={16} color={theme.colors.palette.white} />}
        >
          {isSaving ? "Connecting..." : "Connect"}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
