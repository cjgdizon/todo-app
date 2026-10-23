import type { MetadataRoute } from "next";

// Colors are the light theme's `bg` and `accent` from @todo/ui-tokens.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Todo",
    short_name: "Todo",
    description: "A calm, fast to-do app.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#3f7d6b",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
