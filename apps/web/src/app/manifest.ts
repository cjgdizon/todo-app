import type { MetadataRoute } from "next";

// Colors are the light theme's `bg` and `accent` from @todo/ui-tokens (theme_color is the dark `bg`, the color of the icon).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Todo",
    short_name: "Todo",
    description: "A calm, fast to-do app.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0c0d0f",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
