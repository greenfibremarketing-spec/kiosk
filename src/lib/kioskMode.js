export function isVideoOnly() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("kiosk_app_mode") === "video_only";
  } catch {
    return false;
  }
}
