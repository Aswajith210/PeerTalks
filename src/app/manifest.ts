import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PeerTalks — Connect with People Around the World",
    short_name: "PeerTalks",
    description:
      "A premium social connection platform for meaningful conversations through video and text.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0b",
    theme_color: "#0b0b0b",
    icons: [
      {
        src: "/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/icon-192.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
    ],
  };
}
