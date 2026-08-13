import type { MetadataRoute } from "next";

const PRODUCTION_URL = "https://peer-talks-three.vercel.app";

const envUrl = process.env.NEXT_PUBLIC_SITE_URL;
const BASE_URL =
  envUrl && /^https?:\/\//.test(envUrl) && !/localhost|127\.0\.0\.1/.test(envUrl)
    ? envUrl
    : PRODUCTION_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}