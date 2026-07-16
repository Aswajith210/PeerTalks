"use client";

import { useState, useRef, useCallback } from "react";
import { createPeerConnection, startLocalStream, stopLocalStream } from "@/lib/webrtc/peerConnection";

interface WebRTCState {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export function useWebRTC() {
  const [state, setState] = useState<WebRTCState>({
    localStream: null,
    remoteStream: null,
    connectionState: "new",
    audioEnabled: true,
    videoEnabled: true,
  });
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const initialize = useCallback(async () => {
    const stream = await startLocalStream();
    setState((s) => ({ ...s, localStream: stream }));

    const pc = createPeerConnection(
      () => {},
      (stream) => {
        setState((s) => ({ ...s, remoteStream: stream }));
      },
      (connectionState) => {
        setState((s) => ({ ...s, connectionState }));
      }
    );

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pcRef.current = pc;
    return pc;
  }, []);

  const toggleAudio = useCallback(() => {
    if (state.localStream) {
      const enabled = !state.audioEnabled;
      state.localStream.getAudioTracks().forEach((t) => (t.enabled = enabled));
      setState((s) => ({ ...s, audioEnabled: enabled }));
    }
  }, [state.localStream, state.audioEnabled]);

  const toggleVideo = useCallback(() => {
    if (state.localStream) {
      const enabled = !state.videoEnabled;
      state.localStream.getVideoTracks().forEach((t) => (t.enabled = enabled));
      setState((s) => ({ ...s, videoEnabled: enabled }));
    }
  }, [state.localStream, state.videoEnabled]);

  const cleanup = useCallback(() => {
    stopLocalStream(state.localStream);
    pcRef.current?.close();
    pcRef.current = null;
    setState({
      localStream: null,
      remoteStream: null,
      connectionState: "new",
      audioEnabled: true,
      videoEnabled: true,
    });
  }, [state.localStream]);

  return { ...state, initialize, toggleAudio, toggleVideo, cleanup, pc: pcRef };
}
