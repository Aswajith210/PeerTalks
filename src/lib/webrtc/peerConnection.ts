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
