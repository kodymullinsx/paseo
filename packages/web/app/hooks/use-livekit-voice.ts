'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { AgentStatus } from '../types/realtime-events';

interface UseLiveKitVoiceReturn {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  stream: MediaStream | null;
  agentStatus: AgentStatus;
  connect: (deviceId?: string) => Promise<void>;
  disconnect: () => void;
}

interface UseLiveKitVoiceOptions {
  onEvent?: (event: any) => void;
  onStatusChange?: (status: AgentStatus) => void;
}

interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
}

export function useLiveKitVoice(options: UseLiveKitVoiceOptions = {}): UseLiveKitVoiceReturn {
  const { onEvent, onStatusChange } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('disconnected');

  const roomRef = useRef<Room | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const updateStatus = useCallback((status: AgentStatus) => {
    setAgentStatus(status);
    onStatusChange?.(status);
  }, [onStatusChange]);

  useEffect(() => {
    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.Connected, () => {
      console.log('Connected to LiveKit room');
      setIsConnected(true);
      setIsConnecting(false);
      updateStatus('connected');
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log('Disconnected from LiveKit room');
      setIsConnected(false);
      setIsConnecting(false);
      updateStatus('disconnected');
    });

    room.on(RoomEvent.Reconnecting, () => {
      console.log('Reconnecting to LiveKit room');
      setIsConnecting(true);
      updateStatus('connecting');
    });

    room.on(RoomEvent.Reconnected, () => {
      console.log('Reconnected to LiveKit room');
      setIsConnected(true);
      setIsConnecting(false);
      updateStatus('connected');
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      console.log('Track subscribed:', {
        kind: track.kind,
        participant: participant.identity,
      });

      if (track.kind === Track.Kind.Audio) {
        const audioElement = track.attach();
        audioElement.play().catch(err => {
          console.error('Error playing audio:', err);
        });
      }
    });

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('Participant connected:', participant.identity);
      if (participant.isAgent) {
        console.log('Agent joined the room');
        updateStatus('connected');
      }
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      console.log('Participant disconnected:', participant.identity);
      if (participant.isAgent) {
        console.log('Agent left the room');
      }
    });

    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        const decoder = new TextDecoder();
        const text = decoder.decode(payload);
        const data = JSON.parse(text);
        console.log('Data received from', participant?.identity, ':', data);
        onEvent?.(data);
      } catch (err) {
        console.error('Failed to parse data:', err);
      }
    });

    return () => {
      room.disconnect();
      roomRef.current = null;
    };
  }, [updateStatus, onEvent]);

  const connect = useCallback(async (deviceId?: string) => {
    if (isConnecting || isConnected) return;

    setIsConnecting(true);
    setError(null);
    updateStatus('connecting');

    try {
      if (!window.isSecureContext) {
        throw new Error('HTTPS required. Please access this app over HTTPS or localhost.');
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Media devices not supported in this browser.');
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
      }

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });
      streamRef.current = micStream;
      setStream(micStream);

      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const response = await fetch(`${basePath}/api/session`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to get connection details');
      }
      const connectionDetails: ConnectionDetails = await response.json();

      const room = roomRef.current;
      if (!room) {
        throw new Error('Room not initialized');
      }

      await room.connect(connectionDetails.serverUrl, connectionDetails.participantToken);

      await room.localParticipant.setMicrophoneEnabled(true);

    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setIsConnecting(false);
      setIsConnected(false);
      updateStatus('disconnected');

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setStream(null);
      }
    }
  }, [isConnecting, isConnected, updateStatus]);

  const disconnect = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      room.disconnect();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
    }

    setIsConnected(false);
    setIsConnecting(false);
    setError(null);
    updateStatus('disconnected');
  }, [updateStatus]);

  return {
    isConnected,
    isConnecting,
    error,
    stream,
    agentStatus,
    connect,
    disconnect,
  };
}
