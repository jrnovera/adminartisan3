/**
 * Plays the notification bell sound from the public folder.
 *
 * Browsers block audio from playing until the page has seen a user
 * gesture (a click, tap, or keypress). A realtime booking can arrive at
 * any time — including before the admin has clicked anything — so we
 * "unlock" a single shared Audio element on the first user interaction
 * and reuse it for every play afterwards. Playing before the unlock
 * fails silently (caught below) rather than throwing.
 */

const SOUND_SRC = "/notif-sound/mixkit-cartoon-door-melodic-bell-110.wav";

let sharedAudio: HTMLAudioElement | null = null;
let unlocked = false;

function getAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!sharedAudio) {
    sharedAudio = new Audio(SOUND_SRC);
    sharedAudio.preload = "auto";
    sharedAudio.volume = 0.5;
  }
  return sharedAudio;
}

/**
 * Call once on the first user gesture (click/keydown/touchstart) to grant
 * this tab permission to play audio programmatically later on. Muted +
 * immediately paused so the user never hears anything from the unlock
 * itself.
 */
export function unlockNotificationSound() {
  if (unlocked) return;
  const audio = getAudio();
  if (!audio) return;
  const previousMuted = audio.muted;
  audio.muted = true;
  audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = previousMuted;
      unlocked = true;
    })
    .catch(() => {
      audio.muted = previousMuted;
    });
}

export async function playNotificationSound() {
  const audio = getAudio();
  if (!audio) return;
  try {
    audio.currentTime = 0;
    await audio.play();
  } catch (err) {
    console.warn("Could not play notification sound:", err);
  }
}
