import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Studio } from '@hacktx/shared';
import { DEFAULT_ENVIRONMENT } from '@hacktx/shared';
import { commit } from '@/store/editor';

type Mode = 'translate' | 'rotate' | 'scale';
type Quality = 'balanced' | 'high' | 'ultra';
type Runtime = { scene: T.Scene; group: T.Group; ground: T.Mesh; grid: T.GridHelper; gizmo: TransformControls; orbit: OrbitControls; camera: T.PerspectiveCamera; geometries: Map<string, T.BufferGeometry> };
const modelCache = new Map<string, Promise<T.Object3D>>();
function loadModel(url:string) {
  let pending=modelCache.get(url);
  if(!pending){pending=new Promise((resolve,reject)=>new GLTFLoader().load(url,gltf=>resolve(gltf.scene),undefined,reject));modelCache.set(url,pending);void pending.catch(()=>modelCache.delete(url));}
  return pending.then(model=>model.clone(true));
}
export function SceneViewport({ scene, selected, onSelect, mode, snap, reset, quality }: { scene: Studio; selected?: string; onSelect: (id?: string) => void; mode: Mode; snap: boolean; reset: number; quality: Quality }) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | undefined>(undefined);
  const select = useRef(onSelect); select.current = onSelect;
  const [error, setError] = useState('');
  useEffect(() => {
    const el = host.current!;
    let renderer: T.WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ antialias: true }); } catch { setError('3D rendering requires WebGL. Enable browser hardware acceleration and reload.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const world = new T.Scene();
    const pmrem = new T.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const lighting = pmrem.fromScene(room, .04);
    world.environment = lighting.texture;
    world.environmentIntensity = .35;
    room.dispose(); pmrem.dispose();
    world.fog = new T.Fog('#b8d7eb', 60, 180);
    const camera = new T.PerspectiveCamera(45, 1, .1, 1000); camera.position.set(12, 10, 14);
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.set(0, 1, 0); orbit.update();
    const gizmo = new TransformControls(camera, renderer.domElement); world.add(gizmo.getHelper());
    gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
    gizmo.addEventListener('mouseUp', () => {
      const o = gizmo.object; if (!o) return;
      const clamp = (v: number) => Math.min(100, Math.max(.05, v));
      const size = o.userData.size || 1;
      commit({ type: 'set_primitive', id: o.userData.id, x: o.position.x, y: o.position.y, z: o.position.z, rx: T.MathUtils.radToDeg(o.rotation.x), ry: T.MathUtils.radToDeg(o.rotation.y), rz: T.MathUtils.radToDeg(o.rotation.z), sx: clamp(o.scale.x / size), sy: clamp(o.scale.y / size), sz: clamp(o.scale.z / size) });
    });
    world.add(new T.HemisphereLight(0xdcecff, 0x625543, 1.1));
    const sun = new T.DirectionalLight(0xffe4c2, 2.6); sun.position.set(10, 18, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048,2048); sun.shadow.normalBias=.035; sun.shadow.bias=-.0002; sun.shadow.radius=3; Object.assign(sun.shadow.camera, {left:-30,right:30,top:30,bottom:-30}); world.add(sun);
    const surface = document.createElement('canvas'); surface.width=128;surface.height=128;
    const ctx=surface.getContext('2d')!;
    const pixels=ctx.createImageData(128,128);
    let seed=42;
    for(let i=0;i<pixels.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const v=210+(seed%35);pixels.data[i]=v;pixels.data[i+1]=v;pixels.data[i+2]=v;pixels.data[i+3]=255;}
    ctx.putImageData(pixels,0,0);
    const groundTexture=new T.CanvasTexture(surface);groundTexture.wrapS=groundTexture.wrapT=T.RepeatWrapping;groundTexture.repeat.set(80,80);groundTexture.colorSpace=T.SRGBColorSpace;
    const ground = new T.Mesh(new T.PlaneGeometry(200,200), new T.MeshStandardMaterial({color:'#65766a',roughness:.95,map:groundTexture,bumpMap:groundTexture,bumpScale:.025})); ground.rotation.x=-Math.PI/2; ground.position.y=-.02; ground.receiveShadow=true; world.add(ground);
    const grid = new T.GridHelper(100,100,0x9c9a90,0xcfcdc4); world.add(grid);
    const group = new T.Group(); world.add(group);
    runtime.current={scene:world,group,ground,grid,gizmo,orbit,camera,geometries:new Map()};
    const resize=()=>{camera.aspect=Math.max(1,el.clientWidth)/Math.max(1,el.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth,el.clientHeight);};
    const observer=new ResizeObserver(resize); observer.observe(el); resize();
    let frame=0; const draw=()=>{frame=requestAnimationFrame(draw); renderer.render(world,camera);}; draw();
    let startX=0,startY=0,wasGizmo=false;
    const down=(e:PointerEvent)=>{startX=e.clientX;startY=e.clientY;wasGizmo=!!gizmo.axis;};
    const up=(e:PointerEvent)=>{if(wasGizmo || gizmo.dragging || Math.hypot(e.clientX-startX,e.clientY-startY)>4)return; const rect=renderer.domElement.getBoundingClientRect(); const ray=new T.Raycaster(); ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera); let hit:T.Object3D|null=ray.intersectObjects(group.children,true)[0]?.object??null;while(hit&&hit.parent!==group&&!hit.userData.id)hit=hit.parent;select.current(hit?.userData.id);};
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);
    return ()=>{cancelAnimationFrame(frame); observer.disconnect(); orbit.dispose(); gizmo.dispose(); world.traverse(o=>{if(o instanceof T.Mesh || o instanceof T.LineSegments){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}}); for(const geometry of runtime.current?.geometries.values()??[])geometry.dispose(); ground.geometry.dispose(); grid.geometry.dispose(); groundTexture.dispose(); lighting.dispose(); renderer.dispose();renderer.domElement.remove();runtime.current=undefined;};
  },[]);
  useEffect(()=>{
    const r=runtime.current;if(!r)return;
    r.gizmo.detach();
    for(const child of [...r.group.children]){child.traverse(part=>{if(part instanceof T.Mesh){if(part.userData.uniqueGeometry)part.geometry.dispose();for(const material of Array.isArray(part.material)?part.material:[part.material])material.dispose();}});r.group.remove(child);}
    const detail={balanced:32,high:64,ultra:96}[quality];
    const geometry=(primitive: Studio['objects'][number]['primitive'])=>{
      const key=`${quality}:${primitive}`;
      const cached=r.geometries.get(key);if(cached)return cached;
      const roundedSegments=quality==='balanced'?3:quality==='high'?6:10;
      const created=primitive==='sphere'?new T.SphereGeometry(.5,detail,Math.round(detail*.66))
        :primitive==='cylinder'?new T.CylinderGeometry(.5,.5,1,detail,quality==='ultra'?8:4)
        :primitive==='cone'?new T.ConeGeometry(.5,1,detail,quality==='ultra'?8:4)
        :primitive==='torus'?new T.TorusGeometry(.5,.15,Math.round(detail*.5),detail*2)
        :primitive==='capsule'?new T.CapsuleGeometry(.38,.5,Math.round(detail*.5),detail)
        :new RoundedBoxGeometry(1,1,1,roundedSegments,.055);
      created.computeVertexNormals();r.geometries.set(key,created);return created;
    };
    const sculpt=(base:T.BufferGeometry,o:Studio['objects'][number])=>{
      if(!o.bulge&&!o.taper&&!o.twist)return base;
      const result=base.clone();result.computeBoundingBox();const box=result.boundingBox!;const height=Math.max(.001,box.max.y-box.min.y);const positions=result.getAttribute('position') as T.BufferAttribute;
      for(let index=0;index<positions.count;index++){
        const y=positions.getY(index), normalized=((y-box.min.y)/height)*2-1;
        let x=positions.getX(index),z=positions.getZ(index);
        const radial=1+o.bulge*(1-normalized*normalized);const taper=Math.max(.05,1+o.taper*normalized);x*=radial*taper;z*=radial*taper;
        const angle=T.MathUtils.degToRad(o.twist)*normalized*.5,cos=Math.cos(angle),sin=Math.sin(angle);
        positions.setXYZ(index,x*cos-z*sin,y,x*sin+z*cos);
      }
      positions.needsUpdate=true;result.computeVertexNormals();result.computeBoundingSphere();return result;
    };
    let cancelled=false;
    for(const o of scene.objects){
      if(o.primitive==='model'&&o.assetUrl){
        const root=new T.Group();root.position.set(o.x,o.y,o.z);root.rotation.set(...[o.rx,o.ry,o.rz].map(T.MathUtils.degToRad) as [number,number,number]);root.scale.set(o.sx*o.size,o.sy*o.size,o.sz*o.size);root.userData={id:o.id,size:o.size};r.group.add(root);if(o.id===selected)r.gizmo.attach(root);
        void loadModel(o.assetUrl).then(model=>{if(cancelled)return;const bounds=new T.Box3().setFromObject(model);const dimensions=bounds.getSize(new T.Vector3());const center=bounds.getCenter(new T.Vector3());const max=Math.max(dimensions.x,dimensions.y,dimensions.z,.001);model.position.sub(center);model.position.y+=dimensions.y/2;model.scale.setScalar(1/max);model.traverse(child=>{if(child instanceof T.Mesh){child.castShadow=true;child.receiveShadow=true;}});root.add(model);}).catch(()=>{if(!cancelled)setError(`Could not load ${o.name}. Try another GLB file.`);});
        continue;
      }
      const baseGeometry=geometry(o.primitive);const geo=sculpt(baseGeometry,o);
      const isMetal=/metal|steel|chrome|iron|brass/i.test(o.name), isGlass=/glass|window/i.test(o.name), isWater=/water|river|pool|pond/i.test(o.name);
      const mesh=new T.Mesh(geo,new T.MeshPhysicalMaterial({
        color:o.color,
        roughness:isMetal ? .24 : isGlass ? .08 : isWater ? .16 : .72,
        metalness:isMetal ? .75 : 0,
        clearcoat:(isMetal||isGlass||isWater) ? .7 : .08,
        clearcoatRoughness:.18,
        transparent:isGlass||isWater,
        opacity:isGlass ? .38 : isWater ? .72 : 1,
        transmission:isGlass ? .45 : 0,
        thickness:isGlass ? .15 : 0,
        side:isGlass ? T.DoubleSide : T.FrontSide,
        emissive:o.id===selected ? '#332211' : '#000000'
      }));
      mesh.position.set(o.x,o.y,o.z);mesh.rotation.set(...[o.rx,o.ry,o.rz].map(T.MathUtils.degToRad) as [number,number,number]);mesh.scale.set(o.sx*o.size,o.sy*o.size,o.sz*o.size);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={id:o.id,size:o.size,uniqueGeometry:geo!==baseGeometry};r.group.add(mesh);if(o.id===selected)r.gizmo.attach(mesh);
    }
    return()=>{cancelled=true;};
  },[scene.objects,selected,quality]);
  useEffect(()=>{const r=runtime.current;if(!r)return;const e=scene.environment??DEFAULT_ENVIRONMENT;r.scene.background=new T.Color(e.sky); if(r.scene.fog instanceof T.Fog)r.scene.fog.color.set(e.sky);(r.ground.material as T.MeshStandardMaterial).color.set(e.ground);r.grid.visible=e.grid;},[scene.environment]);
  useEffect(()=>{const g=runtime.current?.gizmo;if(!g)return;g.setMode(mode);g.setTranslationSnap(snap?.5:null);g.setRotationSnap(snap?Math.PI/12:null);g.setScaleSnap(snap?.1:null);},[mode,snap]);
  useEffect(()=>{const r=runtime.current;if(!r)return;const bounds=new T.Box3().setFromObject(r.group);const center=bounds.isEmpty()?new T.Vector3(0,1,0):bounds.getCenter(new T.Vector3());const radius=bounds.isEmpty()?12:Math.max(5,bounds.getSize(new T.Vector3()).length());r.orbit.target.copy(center);r.camera.position.copy(center).add(new T.Vector3(1,.8,1).multiplyScalar(radius));r.orbit.update();},[reset]);
  return <div ref={host} className="relative h-full w-full overflow-hidden touch-none" aria-label="3D scene viewport">{error&&<p role="alert" className="p-6">{error}</p>}</div>;
}
