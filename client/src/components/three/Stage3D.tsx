import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer, CSS3DSprite } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, PerformanceMonitor, Trail } from "@react-three/drei";
import { CANVAS_H, CANVAS_W, type Slide } from "@hacktx/shared";
import { isBusy, selectDeck, useDeck } from "@/store/deck";
import { useEditor } from "@/store/editor";
import { useVoice } from "@/store/voice";
import { Stage } from "../Stage";

/*
 * The 3D stage is a skin over the deck store: it reads slides, the AI focus and the mic level,
 * and edits still go through the same Stage component and ops as the flat editor.
 */

/** Slide size in world units (16:9). */
const W = 1.6;
const H = 0.9;
/** Gap between neighbouring slide centres along the track. */
const SPACING = 1.25;
/** DOM width the slides are laid out at; CSS3D scales it onto W world units. */
const DOM_W = 960;
const ORB_PX = 24;
/** Slides further than this from the current one are drawn as plain planes, without DOM. */
const DOM_RANGE = 3;
const FOV = 38;

const ORB = new THREE.Color("#ffc46b");

/** Coverflow pose for a slide `d` places away from the current one. */
function poseOf(index: number, current: number) {
  const d = index - current;
  const a = Math.min(Math.abs(d), 1);
  const s = Math.sign(d);
  const x = current * SPACING + s * (W * 0.88 * a + Math.max(Math.abs(d) - 1, 0) * W * 0.55);
  const z = -0.75 * a - 0.45 * Math.max(Math.abs(d) - 1, 0);
  return { x, y: 0.02 * a, z, rotY: -s * 0.55 * a };
}

/** Canvas-pixel point on a slide to its local position on the plane. */
const toLocal = (px: number, py: number, out = new THREE.Vector3()) => out.set((px / CANVAS_W - 0.5) * W, (0.5 - py / CANVAS_H) * H, 0.02);

const glowTexture = (() => {
  let tex: THREE.Texture | undefined;
  return () => {
    if (tex) return tex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,214,150,.8)");
    grad.addColorStop(1, "rgba(255,170,80,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    tex = new THREE.CanvasTexture(c);
    return tex;
  };
})();

/**
 * Real DOM (the editable slides, the orb) placed in the scene with CSS 3D transforms. The DOM side
 * portals React content into `el` from the main React tree; the scene side adds `obj`. Portals keep
 * everything in one React root, which matters: per-element roots (drei's Html) race under StrictMode
 * and can blank a slide.
 */
const domPlanes = new Map<string, { el: HTMLDivElement; obj: CSS3DObject }>();
function domPlane(id: string, sprite = false) {
  let plane = domPlanes.get(id);
  if (!plane) {
    const el = document.createElement("div");
    plane = { el, obj: sprite ? new CSS3DSprite(el) : new CSS3DObject(el) };
    domPlanes.set(id, plane);
  }
  return plane;
}
const ORB_ID = "__orb";

/** Shared between the slides, camera and orb within one frame. */
interface SceneRefs {
  groups: Map<string, THREE.Group>;
  drag: { yaw: number; pitch: number; lastMove: number };
}

export default function Stage3D({ className }: { className?: string }) {
  const refs = useMemo<SceneRefs>(() => ({ groups: new Map(), drag: { yaw: 0, pitch: 0, lastMove: 0 } }), []);
  const wrap = useRef<HTMLDivElement>(null);
  const [dpr, setDpr] = useState(Math.min(2, window.devicePixelRatio || 1));
  // Drops resolution first; only gives up on 3D after repeated slow stretches at 1x.
  const slowAtFloor = useRef(0);
  const css = useMemo(() => {
    const r = new CSS3DRenderer();
    Object.assign(r.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    return r;
  }, []);

  useEffect(() => {
    const el = wrap.current;
    el?.appendChild(css.domElement);
    return () => css.domElement.remove();
  }, [css]);

  // Drag on empty stage space to look around; slides themselves keep their own pointer handling.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let start: { x: number; y: number; yaw: number; pitch: number } | undefined;
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      useEditor.getState().select(undefined);
      start = { x: e.clientX, y: e.clientY, yaw: refs.drag.yaw, pitch: refs.drag.pitch };
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      refs.drag.yaw = THREE.MathUtils.clamp(start.yaw - (e.clientX - start.x) * 0.004, -0.7, 0.7);
      refs.drag.pitch = THREE.MathUtils.clamp(start.pitch + (e.clientY - start.y) * 0.003, -0.35, 0.35);
      refs.drag.lastMove = performance.now();
    };
    const up = () => {
      start = undefined;
      el.style.cursor = "";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [refs]);

  return (
    <div ref={wrap} className={className} style={{ isolation: "isolate", cursor: "grab", touchAction: "pan-y" }}>
      <Canvas
        dpr={dpr}
        camera={{ fov: FOV, position: [0, 0, 3], near: 0.1, far: 60 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <PerformanceMonitor
          bounds={() => [24, 50]}
          flipflops={Infinity}
          onDecline={() => {
            if (document.hidden) return;
            if (dpr > 1) return setDpr((d) => Math.max(1, d - 0.5));
            if (++slowAtFloor.current >= 4) useEditor.getState().setView("2d", "slow");
          }}
          onIncline={() => {
            slowAtFloor.current = 0;
            setDpr((d) => Math.min(2, window.devicePixelRatio || 1, d + 0.5));
          }}
        />
        <fog attach="fog" args={["#0a0d1e", 4, 14]} />
        <Scene refs={refs} css={css} />
      </Canvas>
      <DomContent />
    </div>
  );
}

function Scene({ refs, css }: { refs: SceneRefs; css: CSS3DRenderer }) {
  const slides = useDeck((s) => selectDeck(s).slides);
  const slideId = useEditor((s) => s.slideId);
  const current = Math.max(0, slides.findIndex((s) => s.id === slideId));

  return (
    <>
      <CameraRig refs={refs} current={current} slides={slides} />
      <Floor />
      <Particles />
      {slides.map((slide, i) => (
        <SlidePlane key={slide.id} slide={slide} index={i} current={current} refs={refs} />
      ))}
      <AiOrb refs={refs} />
      <CssPass css={css} />
    </>
  );
}

/** Draws the DOM planes after everything else has moved this frame. */
function CssPass({ css }: { css: CSS3DRenderer }) {
  const { scene, camera, size } = useThree();
  useEffect(() => css.setSize(size.width, size.height), [css, size.width, size.height]);
  useFrame(() => {
    camera.updateMatrixWorld();
    css.render(scene, camera);
  });
  return null;
}

/** The DOM half of the 3D stage, rendered from the main React tree into the CSS3D planes. */
function DomContent() {
  const slides = useDeck((s) => selectDeck(s).slides);
  const slideId = useEditor((s) => s.slideId);
  const busy = useDeck(isBusy);
  const current = Math.max(0, slides.findIndex((s) => s.id === slideId));
  const orb = domPlane(ORB_ID, true).el;

  return (
    <>
      {slides.map((slide, i) => {
        const d = i - current;
        const center = d === 0;
        return createPortal(
          <div
            className="relative transition-[filter] duration-500"
            style={{
              width: DOM_W,
              visibility: Math.abs(d) <= DOM_RANGE ? "visible" : "hidden",
              filter: center ? undefined : `brightness(${Math.abs(d) === 1 ? 0.62 : 0.42})`,
              boxShadow: center ? "0 30px 60px -20px rgba(0,0,0,.7)" : undefined,
            }}
          >
            <Stage slide={slide} />
            {/* Non-current slides are a click target that brings them to the centre. */}
            <button
              onClick={() => useEditor.getState().setSlide(slide.id)}
              title={`Go to slide ${i + 1}`}
              aria-hidden={center}
              tabIndex={center ? -1 : 0}
              className="absolute inset-0 cursor-pointer"
              style={{ pointerEvents: center ? "none" : "auto" }}
            />
          </div>,
          domPlane(slide.id).el,
          slide.id,
        );
      })}
      {createPortal(
        <div className="pointer-events-none relative transition-opacity duration-500" style={{ width: ORB_PX, height: ORB_PX, opacity: busy ? 1 : 0.55 }}>
          <span className="orb-core absolute inset-0 rounded-full shadow-[0_0_18px_8px_rgba(255,196,107,.45)] [animation:orb-pulse_1.6s_ease-in-out_infinite]" />
          <span className="absolute -inset-2 rounded-full border-2 border-orb/60 [animation:orb-ring_1.6s_ease-out_infinite]" />
        </div>,
        orb,
        ORB_ID,
      )}
    </>
  );
}

function SlidePlane({ slide, index, current, refs }: { slide: Slide; index: number; current: number; refs: SceneRefs }) {
  const group = useRef<THREE.Group>(null);
  const d = index - current;
  const center = d === 0;
  const withDom = Math.abs(d) <= DOM_RANGE;
  const seed = useMemo(() => Math.random() * Math.PI * 2, []);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    refs.groups.set(slide.id, g);
    // New slides fly in from just behind where they will sit.
    const p = poseOf(index, current);
    if (g.position.lengthSq() === 0) g.position.set(p.x, p.y - 0.3, p.z - 1.2);
    return () => void refs.groups.delete(slide.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.id, refs]);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const p = poseOf(index, current);
    const t = state.clock.elapsedTime;
    // The slide being edited holds still so pointer maths stays exact; the others float.
    const bob = center ? 0 : Math.sin(t * 0.8 + seed) * 0.025;
    const k = 5;
    g.position.x = THREE.MathUtils.damp(g.position.x, p.x, k, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, p.y + bob, k, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, p.z, k, dt);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, p.rotY, k, dt);
  });

  const outline = useMemo(() => {
    const x = W / 2 + 0.05;
    const y = H / 2 + 0.05;
    return [new THREE.Vector3(-x, -y, 0), new THREE.Vector3(x, -y, 0), new THREE.Vector3(x, y, 0), new THREE.Vector3(-x, y, 0), new THREE.Vector3(-x, -y, 0)];
  }, []);

  return (
    <group ref={group}>
      {/* Soft shadow under each slide. */}
      <mesh position={[0, -0.06, -0.04]} scale={[W * 1.5, H * 1.6, 1]}>
        <planeGeometry />
        <meshBasicMaterial map={glowTexture()} color="#000000" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {!withDom && (
        <mesh onClick={() => useEditor.getState().setSlide(slide.id)}>
          <planeGeometry args={[W, H]} />
          <meshBasicMaterial color={slide.background ?? "#ffffff"} />
        </mesh>
      )}
      {center && <Line points={outline} color={ORB} transparent opacity={0.35} lineWidth={1} />}
      <primitive object={domPlane(slide.id).obj} scale={W / DOM_W} />
    </group>
  );
}

/** Glides to the current slide, leans in on the element the AI is editing, and eases back after a drag. */
function CameraRig({ refs, current, slides }: { refs: SceneRefs; current: number; slides: Slide[] }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const tmp = useMemo(() => ({ target: new THREE.Vector3(), pos: new THREE.Vector3(), el: new THREE.Vector3() }), []);

  useFrame((_, dt) => {
    const st = useDeck.getState();
    const half = THREE.MathUtils.degToRad(FOV / 2);
    const aspect = size.width / Math.max(1, size.height);
    // Fit the current slide with room for its neighbours' edges.
    // On a narrow phone screen the current slide gets nearly the full width.
    const margin = aspect < 1 ? 1.08 : 1.3;
    let dist = Math.max((H * margin) / 2 / Math.tan(half), (W * margin) / 2 / (Math.tan(half) * aspect));

    tmp.target.set(current * SPACING, 0, 0);
    const slide = slides[current];
    const el = st.focus?.slideId === slide?.id && isBusy(st) ? slide?.elements.find((e) => e.id === st.focus?.elementId) : undefined;
    if (el) {
      toLocal(el.box.x + el.box.w / 2, el.box.y + el.box.h / 2, tmp.el);
      tmp.target.x += tmp.el.x * 0.35;
      tmp.target.y += tmp.el.y * 0.35;
      dist *= 0.86;
    }

    if (performance.now() - refs.drag.lastMove > 2500) {
      refs.drag.yaw = THREE.MathUtils.damp(refs.drag.yaw, 0, 1.5, dt);
      refs.drag.pitch = THREE.MathUtils.damp(refs.drag.pitch, 0, 1.5, dt);
    }

    look.current.x = THREE.MathUtils.damp(look.current.x, tmp.target.x, 3, dt);
    look.current.y = THREE.MathUtils.damp(look.current.y, tmp.target.y, 3, dt);
    look.current.z = THREE.MathUtils.damp(look.current.z, tmp.target.z, 3, dt);
    const { yaw, pitch } = refs.drag;
    tmp.pos.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 0.04, Math.cos(yaw) * Math.cos(pitch) * dist).add(look.current);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tmp.pos.x, 3, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, tmp.pos.y, 3, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tmp.pos.z, 3, dt);
    camera.lookAt(look.current);
  });

  return null;
}

/** The AI cursor: a glowing orb that arcs to whatever element the AI is touching, leaving a trail. */
function AiOrb({ refs }: { refs: SceneRefs }) {
  const body = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Sprite>(null);
  const tmp = useMemo(() => ({ target: new THREE.Vector3(), from: new THREE.Vector3(), lift: 0 }), []);

  useFrame((state, dt) => {
    const g = body.current;
    if (!g) return;
    const st = useDeck.getState();
    const busy = isBusy(st);
    const slides = selectDeck(st).slides;
    const focusId = st.focus?.slideId;
    const slideId = focusId && refs.groups.has(focusId) ? focusId : (useEditor.getState().slideId ?? slides[0]?.id);
    const group = slideId ? refs.groups.get(slideId) : undefined;
    const slide = slides.find((s) => s.id === slideId);

    if (group && slide) {
      const el = slide.elements.find((e) => e.id === st.focus?.elementId);
      // Sit just past the right edge of the element, like a text caret.
      if (el) toLocal(Math.min(el.box.x + el.box.w, CANVAS_W - 20) + 14, el.box.y + Math.min(el.box.h, 70) / 2, tmp.target);
      else toLocal(CANVAS_W - 40, 40, tmp.target);
      tmp.target.z = 0.08;
      group.localToWorld(tmp.target);
    } else {
      tmp.target.set(0, 0.2, 0.3);
    }

    // Arc: lift the orb in proportion to how far it still has to travel.
    const remaining = g.position.distanceTo(tmp.target);
    tmp.lift = THREE.MathUtils.damp(tmp.lift, Math.min(remaining, 2) * 0.35, 6, dt);
    const t = state.clock.elapsedTime;
    const hover = busy ? 0 : Math.sin(t * 1.4) * 0.03;
    g.position.x = THREE.MathUtils.damp(g.position.x, tmp.target.x, 4.5, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, tmp.target.y + tmp.lift + hover, 4.5, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, tmp.target.z + tmp.lift * 0.5, 4.5, dt);

    const pulse = 1 + Math.sin(t * (busy ? 7 : 2.5)) * 0.08;
    halo.current?.scale.setScalar((busy ? 0.42 : 0.3) * pulse);
  });

  return (
    <group ref={body}>
      <Trail width={0.9} length={5} color={ORB} attenuation={(w) => w * w} decay={1.5}>
        <mesh>
          <sphereGeometry args={[0.03, 16, 16]} />
          <meshBasicMaterial color="#fff6e0" />
        </mesh>
      </Trail>
      <sprite ref={halo}>
        <spriteMaterial map={glowTexture()} color={ORB} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight color={ORB} intensity={1.5} distance={2} />
      {/* DOM copy of the orb, depth-sorted with the DOM slides so it shows in front of them. */}
      <primitive object={domPlane(ORB_ID, true).obj} scale={0.06 / ORB_PX} />
    </group>
  );
}

/** Drifting motes that swell and speed up while someone is talking, and stir a little while the AI works. */
function Particles({ count = 650 }: { count?: number }) {
  const points = useRef<THREE.Points>(null);
  const material = useRef<THREE.PointsMaterial>(null);
  const energy = useRef(0);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 5;
      positions[i * 3 + 2] = -Math.random() * 7 + 0.5;
      speeds[i] = 0.3 + Math.random() * 0.7;
    }
    return { positions, speeds };
  }, [count]);

  useFrame((state, dt) => {
    const p = points.current;
    const m = material.current;
    if (!p || !m) return;
    const voice = useVoice.getState();
    const target = Math.max(voice.state === "recording" ? voice.level : 0, isBusy(useDeck.getState()) ? 0.18 : 0);
    energy.current = THREE.MathUtils.damp(energy.current, target, 8, dt);
    const e = energy.current;

    // Keep the field centred on wherever the camera is looking.
    p.position.x = THREE.MathUtils.damp(p.position.x, state.camera.position.x, 2, dt);
    const arr = p.geometry.attributes.position!.array as Float32Array;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const y = i * 3 + 1;
      arr[y]! += speeds[i]! * dt * (0.04 + e * 0.9);
      arr[i * 3]! += Math.sin(t * 0.5 + i) * dt * 0.01 * (1 + e * 6);
      if (arr[y]! > 2.5) arr[y] = -2.5;
    }
    p.geometry.attributes.position!.needsUpdate = true;
    m.size = 0.028 + e * 0.05;
    m.opacity = 0.35 + e * 0.55;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={material}
        map={glowTexture()}
        color="#ffe2b0"
        size={0.03}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

function Floor() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.position.x = state.camera.position.x;
  });
  return (
    <mesh ref={ref} position={[0, -0.8, -1.5]} rotation={[-Math.PI / 2, 0, 0]} scale={[9, 5, 1]}>
      <planeGeometry />
      <meshBasicMaterial map={glowTexture()} color={ORB} transparent opacity={0.07} depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}
