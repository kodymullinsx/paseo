import { DaemonConnectionTestError } from "@/utils/test-daemon-connection";

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

export function buildConnectionFailureCopy(
  endpoint: string,
  error: unknown
): { title: string; detail: string | null; raw: string | null } {
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

  if (
    rawLower.includes("incompatible protocol version") ||
    rawLower.includes("incompatible protocol") ||
    rawLower.includes("protocol mismatch")
  ) {
    detail =
      "Client and daemon protocol versions are incompatible. Update the Paseo app and/or daemon, then reconnect.";
  } else if (rawLower.includes("timed out")) {
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
  } else if (
    rawLower.includes("certificate") ||
    rawLower.includes("tls") ||
    rawLower.includes("ssl")
  ) {
    detail =
      "TLS/certificate error. This app expects a daemon reachable over the local network or via relay.";
  } else if (raw) {
    detail = "Unable to connect. Check the host/port and that the daemon is reachable.";
  } else {
    detail = "Unable to connect. Check the host/port and that the daemon is reachable.";
  }

  return { title, detail, raw };
}
