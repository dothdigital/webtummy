export async function requestMicrophoneAccess() {
  if (!window.isSecureContext) throw new Error("Voice recording requires a secure HTTPS connection.");
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot access the microphone. Try the latest Chrome or Edge.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (["NotAllowedError", "SecurityError"].includes(name)) {
      try {
        const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        if (permission?.state === "granted") throw new Error("Microphone permission is enabled, but this page could not start it. Reload the page to apply the site policy, then try again.");
      } catch (permissionError) {
        if (permissionError instanceof Error && /permission is enabled/i.test(permissionError.message)) throw permissionError;
      }
      throw new Error("Microphone access was blocked by the browser or operating system. Allow it for this site, then reload the page.");
    }
    if (["NotFoundError", "DevicesNotFoundError"].includes(name)) throw new Error("No microphone was found. Connect or enable a microphone, then try again.");
    if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) throw new Error("The microphone is busy or unavailable. Close other apps using it, then try again.");
    throw new Error("The microphone could not be started. Check the browser and operating-system microphone settings.");
  }
}

export async function speechRecognitionErrorMessage(error: string) {
  if (error === "audio-capture") return "The browser could not capture microphone audio. Check that the correct microphone is enabled and not in use by another app.";
  if (error === "network") return "The browser's speech-recognition service could not connect. Check the connection and try again.";
  if (error === "service-not-allowed") return "Speech recognition is disabled by this browser or browser policy. Try the latest Chrome or Edge.";
  if (error === "not-allowed") {
    try {
      const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (permission?.state === "granted") return "Microphone access is enabled, but the browser blocked its speech-recognition service. Reload the page or try the latest Chrome or Edge.";
    } catch { /* Permissions API is optional. */ }
    return "Microphone access is blocked. Allow it for this site and in your operating-system privacy settings, then reload the page.";
  }
  return "Voice recording stopped unexpectedly. Try again or continue by typing.";
}
