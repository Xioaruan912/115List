import { useEffect, useRef, useState } from "react";
import { absolute } from "../lib/links";

/**
 * Lock screen and notification controls for the player (Media Session): the
 * title and picture, play and pause, 10 s skips, seeking and the next episode,
 * and where playback is. Also whether the video can be sent to a TV (AirPlay in
 * Safari, the Remote Playback API in Chrome), and the call that does it.
 */

export interface SessionMeta { title: string; artist?: string; artwork?: string }

export function useMediaSession(video: HTMLVideoElement | null, meta: SessionMeta, playing: boolean, onNext?: () => void): void {
  const next = useRef(onNext);
  next.current = onNext;
  useEffect(() => {
    if (!("mediaSession" in navigator) || !video) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({
        title: meta.title,
        artist: meta.artist ?? "",
        artwork: meta.artwork ? [{ src: absolute(meta.artwork), sizes: "512x288" }] : [],
      });
    } catch { /* old browsers */ }
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
      try { session.setActionHandler(action, handler); } catch { /* unsupported action */ }
    };
    set("play", () => void video.play());
    set("pause", () => video.pause());
    set("seekbackward", details => { video.currentTime = Math.max(0, video.currentTime - (details.seekOffset ?? 10)); });
    set("seekforward", details => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + (details.seekOffset ?? 10)); });
    set("seekto", details => { if (details.seekTime !== undefined) video.currentTime = details.seekTime; });
    set("nexttrack", next.current ? () => next.current?.() : null);
    const sync = (): void => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      try { session.setPositionState({ duration: video.duration, playbackRate: video.playbackRate || 1, position: Math.min(video.currentTime, video.duration) }); } catch { /* ignore */ }
    };
    const timer = window.setInterval(sync, 2000);
    video.addEventListener("seeked", sync);
    video.addEventListener("ratechange", sync);
    return () => {
      clearInterval(timer);
      video.removeEventListener("seeked", sync);
      video.removeEventListener("ratechange", sync);
      for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto", "nexttrack"] as MediaSessionAction[]) set(action, null);
    };
  }, [video, meta.title, meta.artist, meta.artwork, !!onNext]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);
}

type AirPlayVideo = HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void };

/** Whether there is somewhere to send this video, and how to open the picker. */
export function useCast(video: HTMLVideoElement | null): { available: boolean; cast: () => Promise<void> } {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!video) return;
    const v = video as AirPlayVideo;
    // Safari: AirPlay targets come and go as an event.
    const onAirPlay = (event: Event): void => setAvailable((event as Event & { availability?: string }).availability === "available");
    if (v.webkitShowPlaybackTargetPicker) {
      v.addEventListener("webkitplaybacktargetavailabilitychanged", onAirPlay);
      return () => v.removeEventListener("webkitplaybacktargetavailabilitychanged", onAirPlay);
    }
    // Chrome: the Remote Playback API watches for devices.
    const remote = v.remote;
    if (!remote?.watchAvailability) return;
    let id: number | undefined;
    remote.watchAvailability(value => setAvailable(value)).then(handle => { id = handle; }, () => setAvailable(false));
    return () => { if (id !== undefined) void remote.cancelWatchAvailability(id).catch(() => undefined); };
  }, [video]);
  const cast = async (): Promise<void> => {
    const v = video as AirPlayVideo | null;
    if (!v) return;
    if (v.webkitShowPlaybackTargetPicker) { v.webkitShowPlaybackTargetPicker(); return; }
    await v.remote.prompt();
  };
  return { available, cast };
}
