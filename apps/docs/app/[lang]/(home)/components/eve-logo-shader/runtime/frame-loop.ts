import type { MutableRefObject } from "react";
import { evePointerInteractionMode, mobileAutoEnvYaw } from "../mobile-motion";
import type { ImprintRenderOptions, RenderControls } from "../render";
import { getCanvasLogicalSize, resizeCanvas } from "./canvas-sizing";
import type { EveTransitionDebugState } from "./debug-gui";
import type { ControlsRef, HeroRuntimeState } from "./state";

// Owns the Eve hero rAF draw loop and canvas reveal sequencing.
// INVARIANT: dataset markers, paint movement gating, and fallback-on-error behavior are preserved.
// Imported only by index.tsx's single effect.

const ENV_YAW_LERP_SPEED = 3;
export const AGENTS_ENV_YAW_LERP_SPEED = 3;
const AGENTS_ENV_YAW_OFFSET = -Math.PI * 0.1;
const ASCII_MOUSE_LERP_SPEED = 6;
const PAINT_MOVEMENT_GRACE_MS = 72;
const CANVAS_FADE_FALLBACK_MS = 800;
const CANVAS_REVEAL_RENDER_COUNT = 3;
const MAX_FRAME_DELTA_SECONDS = 0.05;
export const AGENTS_MAX_FRAME_DELTA_SECONDS = MAX_FRAME_DELTA_SECONDS;

const PROBE_DATASET_WRITE_INTERVAL_MS = 250;

type Renderer = {
  render: (
    target: GPUTextureView,
    controls: RenderControls,
    logicalWidth: number,
    logicalHeight: number,
    imprint?: ImprintRenderOptions,
  ) => void;
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";

type EveHeroFrameLoopProbe = {
  frames: number;
  running: boolean;
  lastFrameAt: number;
};

declare global {
  interface Window {
    __eveHeroFrameLoop?: EveHeroFrameLoopProbe;
  }
}

function getHeroFrameLoopProbe(): EveHeroFrameLoopProbe | undefined {
  if (IS_PRODUCTION) return undefined;
  if (typeof window === "undefined") return undefined;
  if (!window.__eveHeroFrameLoop) {
    window.__eveHeroFrameLoop = {
      frames: 0,
      running: false,
      lastFrameAt: 0,
    };
  }
  return window.__eveHeroFrameLoop;
}

export function createDrawLoop({
  state,
  canvas,
  context,
  renderer,
  controlsRef,
  transitionDebug,
  modeTransitionProgressRef,
  targetLogoModeProgressRef,
  targetAgentsEnvYawMixRef,
  defaultMaterial,
  onCanvasRevealed,
  onFallback,
  onFatalError,
}: {
  state: HeroRuntimeState;
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  renderer: Renderer;
  controlsRef: ControlsRef;
  transitionDebug: EveTransitionDebugState;
  modeTransitionProgressRef: MutableRefObject<number>;
  targetLogoModeProgressRef: MutableRefObject<number>;
  targetAgentsEnvYawMixRef: MutableRefObject<number>;
  defaultMaterial: RenderControls["material"];
  onCanvasRevealed: () => void;
  onFallback: () => void;
  onFatalError: () => void;
}) {
  let successfulRenderCount = 0;
  let finishCanvasFade: (() => void) | undefined;
  let running = false;
  const frameLoopProbe = getHeroFrameLoopProbe();
  let lastProbeDatasetWrite = 0;

  const updateFrameLoopProbeDataset = (force = false) => {
    if (!frameLoopProbe) return;
    const now = performance.now();
    if (!force && now - lastProbeDatasetWrite < PROBE_DATASET_WRITE_INTERVAL_MS) return;
    lastProbeDatasetWrite = now;
    canvas.dataset.heroFrames = String(frameLoopProbe.frames);
    canvas.dataset.heroRunning = String(frameLoopProbe.running);
    canvas.dataset.heroLastFrameAt = String(Math.round(frameLoopProbe.lastFrameAt));
  };

  const draw = (frameTime = performance.now()) => {
    if (state.cancelled) return;

    const deltaSeconds = Math.min(
      MAX_FRAME_DELTA_SECONDS,
      Math.max(0, (frameTime - state.previousFrameTime) / 1000),
    );
    state.previousFrameTime = frameTime;
    if (evePointerInteractionMode(state.isCoarsePointer).autoRotateEnvYaw) {
      state.targetMouseEnvYaw = mobileAutoEnvYaw((frameTime - state.autoRotateStartTime) / 1000);
      state.targetMouseEnvPitch = 0;
      state.targetBrushActive = false;
    }
    state.mouseEnvYaw = safeLerp(
      state.mouseEnvYaw,
      state.targetMouseEnvYaw,
      deltaSeconds * ENV_YAW_LERP_SPEED,
    );
    state.mouseEnvPitch = safeLerp(
      state.mouseEnvPitch,
      state.targetMouseEnvPitch,
      deltaSeconds * ENV_YAW_LERP_SPEED,
    );
    state.asciiMouseX = safeLerp(
      state.asciiMouseX,
      state.targetAsciiMouseX,
      deltaSeconds * ASCII_MOUSE_LERP_SPEED,
    );
    state.asciiMouseY = safeLerp(
      state.asciiMouseY,
      state.targetAsciiMouseY,
      deltaSeconds * ASCII_MOUSE_LERP_SPEED,
    );
    state.brushActive = state.targetBrushActive && state.hasBrushCell;
    const targetAgentsEnvYawMix = targetAgentsEnvYawMixRef.current;
    state.agentsEnvYawMix = safeLerp(
      state.agentsEnvYawMix,
      targetAgentsEnvYawMix,
      deltaSeconds * AGENTS_ENV_YAW_LERP_SPEED,
    );
    controlsRef.current.envYaw = state.mouseEnvYaw + state.agentsEnvYawMix * AGENTS_ENV_YAW_OFFSET;
    controlsRef.current.envPitch = state.mouseEnvPitch;

    const devicePixelRatio = resizeCanvas(canvas);
    const { logicalWidth, logicalHeight } = getCanvasLogicalSize(canvas, devicePixelRatio);

    try {
      const transitionDurationSeconds = clampRange(transitionDebug.durationSeconds, 0.05, 2);
      modeTransitionProgressRef.current = stepLogoModeProgress(
        modeTransitionProgressRef.current,
        targetLogoModeProgressRef.current,
        deltaSeconds,
        transitionDurationSeconds,
      );
      const animatedMixProgress = easeLogoModeProgress(modeTransitionProgressRef.current);
      const mixProgress = transitionDebug.overrideEnabled
        ? clampUnit(transitionDebug.progress)
        : animatedMixProgress;
      const timeSeconds = frameTime / 1000;
      const gridScaleMultiplier = clampRange(transitionDebug.gridScaleMultiplier, 0.5, 2);
      state.paintGridScaleMultiplier = gridScaleMultiplier;
      controlsRef.current.material = transitionDebug.visualizePaintBuffer
        ? "paint-debug"
        : defaultMaterial;
      const brushPreviousCell: readonly [number, number] = state.hasRenderedBrushCell
        ? [state.previousRenderedBrushCellX, state.previousRenderedBrushCellY]
        : [state.brushCellX, state.brushCellY];
      const brushCanWrite =
        state.brushActive && frameTime - state.lastBrushMoveTime <= PAINT_MOVEMENT_GRACE_MS;
      renderer.render(
        context.getCurrentTexture().createView(),
        controlsRef.current,
        logicalWidth,
        logicalHeight,
        {
          progress: mixProgress,
          gridScaleMultiplier,
          glyphScale: clampRange(transitionDebug.glyphScale, 0.5, 2.5),
          time: timeSeconds,
          mouse: [state.asciiMouseX, state.asciiMouseY],
          devicePixelRatio,
          paint: {
            // rAF timestamps are ms; deltaSeconds is converted once above and all paint
            // decay/diffusion/brush math expects seconds. Brush cells are raw pointer cells
            // (no lerp); the shader stamps the segment from previous rendered cell to current.
            dt: deltaSeconds,
            brushCell: [state.brushCellX, state.brushCellY],
            brushPreviousCell,
            brushRadius: clampRange(transitionDebug.brushRadius, 1, 8),
            brushStrength: clampRange(transitionDebug.brushStrength, 4, 32),
            brushActive: brushCanWrite,
            decayRate: clampRange(transitionDebug.paintDecayPerFrame120, 0.002, 0.08) * 120,
            diffusionRate: clampRange(transitionDebug.diffusionAmount, 0, 24),
            diffusionJitter: clampRange(transitionDebug.diffusionJitter, 0, 4),
          },
        },
      );

      if (state.hasBrushCell) {
        state.previousRenderedBrushCellX = state.brushCellX;
        state.previousRenderedBrushCellY = state.brushCellY;
        state.hasRenderedBrushCell = true;
      }

      canvas.dataset.eveRenderMode = mixProgress >= 0.5 ? "agents" : "humans";
      canvas.dataset.eveAsciiProgress = mixProgress.toFixed(3);
      canvas.dataset.eveAsciiMode = mixProgress > 0.001 ? "active" : "inactive";
    } catch {
      state.cancelled = true;
      onFallback();
      onFatalError();
      return;
    }

    successfulRenderCount += 1;
    if (successfulRenderCount === CANVAS_REVEAL_RENDER_COUNT) {
      canvas.style.opacity = "1";
      finishCanvasFade = onCanvasFullyOpaque(canvas, onCanvasRevealed);
    }

    if (frameLoopProbe) {
      frameLoopProbe.frames += 1;
      frameLoopProbe.lastFrameAt = frameTime;
      updateFrameLoopProbeDataset();
    }

    if (running) state.animationFrame = requestAnimationFrame(draw);
  };

  const start = () => {
    if (running) return;
    running = true;
    if (frameLoopProbe) {
      frameLoopProbe.running = true;
      updateFrameLoopProbeDataset(true);
    }
    const frameTime = performance.now();
    state.previousFrameTime = frameTime;
    if (evePointerInteractionMode(state.isCoarsePointer).autoRotateEnvYaw) {
      state.autoRotateStartTime = frameTime;
    }
    state.animationFrame = requestAnimationFrame(draw);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
    if (frameLoopProbe) {
      frameLoopProbe.running = false;
      updateFrameLoopProbeDataset(true);
    }
  };

  return {
    start,
    stop,
    dispose() {
      stop();
      finishCanvasFade?.();
    },
  };
}

function safeLerp(from: number, to: number, amount: number) {
  const safeAmount = Math.max(0, Math.min(1, amount));
  return from + (to - from) * safeAmount;
}

function clampUnit(value: number) {
  return clampRange(value, 0, 1);
}

function clampRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stepLogoModeProgress(
  current: number,
  target: number,
  deltaSeconds: number,
  durationSeconds: number,
) {
  const safeTarget = target >= 0.5 ? 1 : 0;
  const safeDuration = clampRange(durationSeconds, 0.05, 2);
  const step = Math.max(0, deltaSeconds) / safeDuration;
  if (Math.abs(safeTarget - current) <= step) return safeTarget;
  return current + Math.sign(safeTarget - current) * step;
}

function easeLogoModeProgress(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

function onCanvasFullyOpaque(canvas: HTMLCanvasElement, callback: () => void) {
  let done = false;
  let timeout = 0;
  const finish = () => {
    if (done) return;
    done = true;
    canvas.removeEventListener("transitionend", onTransitionEnd);
    window.clearTimeout(timeout);
    if (canvas.isConnected) callback();
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.propertyName === "opacity") finish();
  };

  canvas.addEventListener("transitionend", onTransitionEnd);
  timeout = window.setTimeout(finish, CANVAS_FADE_FALLBACK_MS);
  return finish;
}
