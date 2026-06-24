import { useCallback, useEffect, useRef, useState } from "react";
import videoAsset from "@/assets/paper-boat.mp4.asset.json";
import audioAsset from "@/assets/paper-boat-drift.mp3.asset.json";

const SCROLL_VH = 500;

export function PaperBoatExperience() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [started, setStarted] = useState(false);
  const [showOpening, setShowOpening] = useState(true);
  const [showButton, setShowButton] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showEnding, setShowEnding] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  const setEndingVisible = useCallback((visible: boolean) => {
    setShowEnding((current) => (current === visible ? current : visible));
  }, []);

  // Opening text → button reveal
  useEffect(() => {
    const t1 = setTimeout(() => setShowOpening(false), 3000);
    const t2 = setTimeout(() => setShowButton(true), 3800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Playback-driven scroll engine
  //
  // Game-dev principles applied (kept simple on purpose):
  //
  // 1. Frame-rate independent smoothing.
  //    Instead of `pos += (target - pos) * 0.05` (which is faster on 144Hz
  //    monitors than on 60Hz), we use exponential smoothing with real dt:
  //        alpha = 1 - exp(-rate * dt)
  //    `rate` has units of 1/second, so the feel stays identical regardless
  //    of refresh rate. This is the standard trick used in platformer cameras.
  //
  // 2. Asymmetric easing (accel / decel feel).
  //    Forward and backward use different `rate` values so the reverse motion
  //    settles a bit slower — matches the previously tuned 15% / 30% smoothing.
  //
  // 3. No cumulative drift.
  //    `reverseTime` is always re-anchored to `video.currentTime` whenever we
  //    are not actively reversing. That prevents the classic side-scroller bug
  //    where a private "world position" slowly desyncs from the rendered
  //    position after rapid direction changes.
  //
  // 4. Rapid direction-change safety.
  //    Forward motion uses native HTMLVideoElement playback (best quality
  //    decode). Reverse motion pauses playback and steps backward in small,
  //    bounded increments. When we flip directions we reset the chase anchor
  //    on the same frame so no stale velocity bleeds across.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!started) return;
    const video = videoRef.current;
    if (!video) return;

    const clamp = (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v));

    // Tuning constants — read these to learn the feel of the system.
    const FORWARD_RATE = 2.876;   // higher = snappier forward chase
    const REVERSE_RATE = 5.25;    // higher = reverse camera catches up sooner
    const FORWARD_DEADZONE = 0.035;  // sec: ignore tiny forward diffs
    const REVERSE_DEADZONE = 0.018;  // sec: avoid tiny decoder-stalling reverse seeks
    // Reverse scrubbing is "latest target wins" instead of stepping through
    // every intermediate frame. This matches pro game-camera behavior: stay
    // visually aligned with the player input, even if the decoder is slow.
    const REVERSE_SEEK_REPLACE_MS = 90; // latest-wins scrub cadence for slow decoders

    let raf = 0;
    let maxScroll = 1;
    let targetProgress = 0;
    let smoothedProgress = 0;
    let reverseTime = video.currentTime || 0;
    let lastTs = performance.now();

    // Reverse-seek scheduler.
    let seekPending = false;
    let seekStartTs = 0;

    // ---- Perf instrumentation ------------------------------------------------
    // Lightweight counters flushed to the console once per second. Disable with
    // `window.__boatPerf = false` in devtools.
    const perf = {
      frames: 0,
      frameTimeSum: 0,
      frameTimeMax: 0,
      longFrames: 0,        // > 32ms (missed 30fps budget)
      seeksIssued: 0,
      seeksCompleted: 0,
      seekDurSum: 0,
      seekDurMax: 0,
      seeksDropped: 0,      // wanted to seek but decoder still busy
      seeksReplaced: 0,     // slow seek was replaced with a newer target
      lastFlush: performance.now(),
      dir: "idle" as "idle" | "fwd" | "rev",
    };
    const PERF_ON =
      (window as unknown as { __boatPerf?: boolean }).__boatPerf !== false;
    const flushPerf = (now: number) => {
      if (!PERF_ON) return;
      if (now - perf.lastFlush < 1000) return;
      const avgFrame = perf.frames ? perf.frameTimeSum / perf.frames : 0;
      const avgSeek = perf.seeksCompleted
        ? perf.seekDurSum / perf.seeksCompleted
        : 0;
      // eslint-disable-next-line no-console
      console.log(
        `[boat] dir=${perf.dir} fps≈${perf.frames} ` +
          `frame avg=${avgFrame.toFixed(1)}ms max=${perf.frameTimeMax.toFixed(1)}ms long=${perf.longFrames} | ` +
          `seeks issued=${perf.seeksIssued} done=${perf.seeksCompleted} dropped=${perf.seeksDropped} replaced=${perf.seeksReplaced} ` +
          `avg=${avgSeek.toFixed(1)}ms max=${perf.seekDurMax.toFixed(1)}ms`,
      );
      perf.frames = 0;
      perf.frameTimeSum = 0;
      perf.frameTimeMax = 0;
      perf.longFrames = 0;
      perf.seeksIssued = 0;
      perf.seeksCompleted = 0;
      perf.seekDurSum = 0;
      perf.seekDurMax = 0;
      perf.seeksDropped = 0;
      perf.seeksReplaced = 0;
      perf.lastFlush = now;
    };

    const onSeeked = () => {
      if (seekPending) {
        const dur = performance.now() - seekStartTs;
        perf.seeksCompleted += 1;
        perf.seekDurSum += dur;
        if (dur > perf.seekDurMax) perf.seekDurMax = dur;
      }
      seekPending = false;
    };
    video.addEventListener("seeked", onSeeked);

    const fastSeek =
      typeof (video as HTMLVideoElement & { fastSeek?: (t: number) => void }).fastSeek ===
      "function"
        ? (t: number) =>
            (video as HTMLVideoElement & { fastSeek: (t: number) => void }).fastSeek(t)
        : (t: number) => { video.currentTime = t; };

    const refreshScrollMetrics = () => {
      maxScroll = Math.max(
        1,
        (containerRef.current?.scrollHeight ?? window.innerHeight) -
          window.innerHeight,
      );
    };

    const updateTargetProgress = () => {
      targetProgress = clamp(window.scrollY / maxScroll, 0, 1);
    };

    refreshScrollMetrics();
    updateTargetProgress();
    smoothedProgress = targetProgress;

    window.addEventListener("scroll", updateTargetProgress, { passive: true });
    window.addEventListener("resize", refreshScrollMetrics);

    const tick = (now: number) => {
      // dt clamped — keeps math stable after a tab-switch / long frame.
      const dtMs = now - lastTs;
      const dt = Math.min(0.05, Math.max(0.001, dtMs / 1000));
      lastTs = now;

      // Perf: per-frame timing
      perf.frames += 1;
      perf.frameTimeSum += dtMs;
      if (dtMs > perf.frameTimeMax) perf.frameTimeMax = dtMs;
      if (dtMs > 32) perf.longFrames += 1;

      // Frame-rate independent ease toward the scroll target.
      const goingForward = targetProgress >= smoothedProgress;
      const rate = goingForward ? FORWARD_RATE : REVERSE_RATE;
      const alpha = 1 - Math.exp(-rate * dt);
      smoothedProgress += (targetProgress - smoothedProgress) * alpha;

      const duration = video.duration || 0;
      if (duration > 0) {
        const target = smoothedProgress * duration;
        const cur = video.currentTime;
        const diff = target - cur;

        if (diff > FORWARD_DEADZONE) {
          perf.dir = "fwd";
          reverseTime = cur;
          video.playbackRate = clamp(diff * 1.4875, 0.3, 2.1);
          if (video.paused) video.play().catch(() => {});
        } else if (diff < -REVERSE_DEADZONE) {
          perf.dir = "rev";
          if (!video.paused) video.pause();
          // Reverse video cannot play natively, so treat it like a game camera
          // scrubbing a timeline: seek to the newest useful position and skip
          // tiny intermediate frames. If a decoder stalls, replace the pending
          // seek after a short budget instead of waiting seconds and falling
          // visibly behind the user's scroll.
          const canSeekNow =
            !seekPending || now - seekStartTs > REVERSE_SEEK_REPLACE_MS;
          if (canSeekNow) {
            if (seekPending) perf.seeksReplaced += 1;
            reverseTime = clamp(target, 0, duration);
            seekPending = true;
            seekStartTs = now;
            perf.seeksIssued += 1;
            try {
              fastSeek(reverseTime);
            } catch {
              seekPending = false;
            }
          } else {
            perf.seeksDropped += 1;
          }
        } else {
          perf.dir = "idle";
          if (!video.paused) video.pause();
          reverseTime = cur;
        }

        const endingThreshold = Math.max(duration - 0.6, duration * 0.97);
        setEndingVisible(video.currentTime >= endingThreshold);
      }

      flushPerf(now);
      raf = requestAnimationFrame(tick);
    };


    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updateTargetProgress);
      window.removeEventListener("resize", refreshScrollMetrics);
      video.removeEventListener("seeked", onSeeked);
      if (!video.paused) video.pause();
    };
  }, [setEndingVisible, started]);


  const handleBegin = async () => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (audio) {
      audio.loop = true;
      audio.volume = 0.7;
      try {
        await audio.play();
      } catch {}
    }
    if (video) {
      try {
        await video.play();
        video.pause();
        video.currentTime = 0;
      } catch {}
    }
    setShowButton(false);
    setTimeout(() => setStarted(true), 600);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  return (
    <>
      {/* Scroll spacer */}
      <div
        ref={containerRef}
        style={{ height: started ? `${SCROLL_VH}vh` : "100vh" }}
      />

      {/* Pinned video stage */}
      <div className="fixed inset-0 z-0 overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={videoAsset.url}
          muted
          playsInline
          preload="auto"
          onLoadedData={() => setVideoReady(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            filter:
              "saturate(1.28) contrast(1.08) brightness(1.06) hue-rotate(-2deg)",
            willChange: "transform",
          }}
        />
        {/* Bloom / glow layer */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 35%, rgba(255,220,160,0.18), transparent 55%)",
            mixBlendMode: "screen",
          }}
        />
        {/* Soft atmospheric haze */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 100%, rgba(255,200,140,0.10), transparent 60%), radial-gradient(ellipse at 50% 0%, rgba(0,20,40,0.25), transparent 55%)",
          }}
        />
        {/* Subtle cinematic tint (always on, slightly stronger pre-start) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-1000"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.14) 0%, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.18) 100%)",
            opacity: started ? 0.55 : 1,
          }}
        />
      </div>

      {/* Audio (continuous, scroll-independent) */}
      <audio ref={audioRef} src={audioAsset.url} preload="auto" />

      {/* Mute button */}
      {started && (
        <button
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="fixed right-6 top-6 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white shadow-lg backdrop-blur-md transition hover:bg-white/20"
        >
          {muted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          )}
        </button>
      )}

      {/* Opening text */}
      <div
        className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center px-8 text-center transition-opacity duration-[1200ms] ease-out"
        style={{ opacity: showOpening ? 1 : 0 }}
      >
        <h1
          className="max-w-2xl text-balance text-2xl font-light italic leading-tight text-white/95 md:text-3xl lg:text-4xl"
          style={{
            fontFamily: '"Cormorant Garamond", serif',
            fontWeight: 300,
            textShadow:
              "0 0 22px rgba(255,240,210,0.45), 0 0 60px rgba(255,220,180,0.18)",
            letterSpacing: "0.005em",
          }}
        >
          Somewhere downstream, a paper boat drifts…
        </h1>
      </div>

      {/* Begin Journey button */}
      <div
        className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center transition-opacity duration-[1000ms]"
        style={{ opacity: showButton && !started ? 1 : 0 }}
      >
        <button
          onClick={handleBegin}
          className="pointer-events-auto rounded-full border border-white/40 bg-white/10 px-7 py-2.5 text-white shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-md transition hover:bg-white/20 hover:border-white/60"
          style={{
            fontFamily: '"Cormorant Garamond", serif',
            fontWeight: 400,
            fontSize: "1rem",
            letterSpacing: "0.08em",
            textShadow: "0 0 12px rgba(255,240,210,0.4)",
          }}
        >
          Begin Journey
        </button>
      </div>

      {/* Ending text */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[10vh] z-20 flex justify-center px-8 text-center transition-opacity duration-[1600ms] ease-out"
        style={{ opacity: showEnding ? 1 : 0 }}
      >
        <p
          className="text-balance text-2xl font-light italic text-white/95 md:text-3xl lg:text-4xl"
          style={{
            fontFamily: '"Cormorant Garamond", serif',
            fontWeight: 300,
            textShadow:
              "0 0 22px rgba(255,240,210,0.45), 0 0 60px rgba(255,220,180,0.18)",
            letterSpacing: "0.005em",
          }}
        >
          And the journey continues…
        </p>
      </div>

      {/* Ending warm bloom overlay */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-10 transition-opacity duration-[2000ms]"
        style={{
          opacity: showEnding ? 1 : 0,
          background:
            "radial-gradient(ellipse at 50% 55%, rgba(255,200,130,0.18), transparent 60%), radial-gradient(ellipse at 50% 100%, rgba(255,180,110,0.12), transparent 70%)",
          mixBlendMode: "screen",
        }}
      />
    </>
  );
}
