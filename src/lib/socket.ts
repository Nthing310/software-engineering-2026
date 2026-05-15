import { io } from "socket.io-client";

// In development, the Vite dev server proxies aren't completely necessary because Socket.IO
// can handle URLs directly, but we use "/" for the same-origin relative path.
export const socket = io("/", {
  path: "/socket.io/",
  transports: ["websocket", "polling"],
});
