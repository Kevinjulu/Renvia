import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const MARK = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" fill="#141414"/>
    <path d="M10 23V9H17.5C20 9 22 10.8 22 13.3C22 15.3 20.7 16.9 18.8 17.5L22.5 23H19.3L16 18H13V23H10ZM13 15.4H17.2C18.5 15.4 19.4 14.6 19.4 13.3C19.4 12.1 18.5 11.3 17.2 11.3H13V15.4Z" fill="#2F6FED"/>
  </svg>`,
)}`;

export default function AppleIcon() {
  // eslint-disable-next-line @next/next/no-img-element
  return new ImageResponse(<img src={MARK} width={180} height={180} alt="" />, size);
}
