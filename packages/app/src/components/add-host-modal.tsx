import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { StyleSheet, UnistylesRuntime, useUnistyles } from "react-native-unistyles";
import { Link2 } from "lucide-react-native";
import { MANAGED_DIRECT_ENDPOINT, useDaemonRegistry, type HostProfile } from "@/contexts/daemon-registry-context";
import { probeConnection } from "@/utils/test-daemon-connection";
import { buildConnectionFailureCopy } from "@/utils/connection-failure-copy";
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
