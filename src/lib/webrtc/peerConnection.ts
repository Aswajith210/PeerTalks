export async function startLocalStream(
  constraints: MediaStreamConstraints = {
    video: {
      // Cap resolution: an unconstrained getUserMedia defaults to the
      // camera's maximum (4K on many phones), which wrecks mobile decode
      // and upload. 720p keeps the call smooth with no visible quality loss.
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
    },
    audio: true,
  }
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
