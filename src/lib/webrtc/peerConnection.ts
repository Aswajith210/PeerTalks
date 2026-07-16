const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function createPeerConnection(
  onIceCandidate: (candidate: RTCIceCandidate) => void,
  onTrack: (stream: MediaStream) => void,
  onConnectionStateChange: (state: RTCPeerConnectionState) => void
): RTCPeerConnection {
  const pc = new RTCPeerConnection(ICE_SERVERS);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      onIceCandidate(event.candidate);
    }
  };

  pc.ontrack = (event) => {
    onTrack(event.streams[0]);
  };

  pc.onconnectionstatechange = () => {
    onConnectionStateChange(pc.connectionState);
  };

  return pc;
}

export async function startLocalStream(
  constraints: MediaStreamConstraints = { video: true, audio: true }
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function stopLocalStream(stream: MediaStream | null) {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

export function toggleTrack(
  stream: MediaStream | null,
  kind: "audio" | "video",
  enabled: boolean
) {
  if (stream) {
    stream.getTracks()
      .filter((t) => t.kind === kind)
      .forEach((t) => (t.enabled = enabled));
  }
}
