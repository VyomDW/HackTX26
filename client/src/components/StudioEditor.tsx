import { useRef, useState } from 'react';
import type { Studio, SceneObject } from '@hacktx/shared';
import { DEFAULT_ENVIRONMENT } from '@hacktx/shared';
import { commit } from '@/store/editor';
import { undoMine, redoMine } from '@/lib/actions';
import { SceneViewport } from './SceneViewport';
import { cn } from '@/lib/utils';
import { api } from '@/lib/auth';

// Shared ink-theme classes for the studio's controls.
const tb='h-8 shrink-0 rounded-md px-2 text-xs font-medium hover:bg-slate-100';
const field='w-full rounded-md border-[1.5px] border-line bg-white p-1.5 outline-none focus:border-[var(--ink)]';
const chip='rounded-md border-[1.5px] border-[var(--ink)] bg-panel px-2 py-1 font-medium shadow-[2px_2px_0_var(--ink)] active:translate-x-px active:translate-y-px active:shadow-none';
const h2='mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500';

type GenerationQuality='low'|'medium'|'high';
type GenerationJob={id:string;prompt:string;quality:Exclude<GenerationQuality,'low'>;progress:number;status:string;error?:string};

export function StudioEditor({scene,onPrompt}:{scene:Studio;onPrompt:(text:string)=>void}) {
  const [selected,setSelected]=useState<string>();
  const [mode,setMode]=useState<'translate'|'rotate'|'scale'>('translate');
  const [quality,setQuality]=useState<'balanced'|'high'|'ultra'>('high');
  const [modelPrompt,setModelPrompt]=useState('');
  const [generationQuality,setGenerationQuality]=useState<GenerationQuality>('medium');
  const [jobs,setJobs]=useState<GenerationJob[]>([]);
  const [notice,setNotice]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  const [snap,setSnap]=useState(false);const [reset,setReset]=useState(0);
  const chosen=scene.objects.find(o=>o.id===selected);
  const env=scene.environment??DEFAULT_ENVIRONMENT;
  const edit=(patch:Partial<SceneObject>)=>chosen&&commit({type:'set_primitive',id:chosen.id,...patch});
  const add=(primitive:SceneObject['primitive'])=>{const id=crypto.randomUUID();commit({type:'add_primitive',id,name:primitive,primitive,x:0,y:.5,z:0,color:'#e58a43'});setSelected(id);};
  const addModel=(assetUrl:string,name:string)=>{const id=crypto.randomUUID();commit({type:'add_primitive',id,name,primitive:'model',assetUrl,x:0,y:0,z:0,color:'#ffffff'});setSelected(id);};
  const importModel=async(file?:File)=>{
    if(!file)return;
    if(!file.name.toLowerCase().endsWith('.glb')||file.size>8*1024*1024){setNotice('Choose a .glb file smaller than 8 MB.');return;}
    const reader=new FileReader();reader.onload=()=>{addModel(String(reader.result),file.name.replace(/\.glb$/i,''));setNotice('Textured model added.');};reader.onerror=()=>setNotice('Could not read that model.');reader.readAsDataURL(file);
  };
  const updateJob=(id:string,patch:Partial<GenerationJob>)=>setJobs(current=>current.map(job=>job.id===id?{...job,...patch}:job));
  const pollTask=async(taskId:string,onProgress:(value:number)=>void)=>{
    for(let attempt=0;attempt<120;attempt++){await new Promise(resolve=>setTimeout(resolve,2000));const response=await api(`/studio/meshy/tasks/${encodeURIComponent(taskId)}`);const status=await response.json() as {status?:string;progress?:number;assetUrl?:string;error?:string};if(!response.ok)throw new Error(status.error||'Could not check generation.');onProgress(status.progress??0);if(status.status==='SUCCEEDED')return status;if(status.status==='FAILED'||status.status==='CANCELED')throw new Error(status.error||'3D generation failed.');}
    throw new Error('Generation is taking longer than expected.');
  };
  const runApiJob=async(job:GenerationJob)=>{
    try{
      updateJob(job.id,{status:'Building geometry'});const started=await api('/studio/meshy/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:job.prompt,quality:job.quality})});const task=await started.json() as {result?:string;error?:string};if(!started.ok||!task.result)throw new Error(task.error||'Could not start generation.');
      const preview=await pollTask(task.result,value=>updateJob(job.id,{progress:job.quality==='high'?Math.round(value/2):value}));
      if(job.quality==='medium'){if(!preview.assetUrl)throw new Error('Meshy returned no model file.');addModel(preview.assetUrl,job.prompt.slice(0,50));updateJob(job.id,{progress:100,status:'Added to scene'});return;}
      updateJob(job.id,{progress:50,status:'Adding PBR textures'});const refined=await api('/studio/meshy/refine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({previewTaskId:task.result,prompt:job.prompt})});const refineTask=await refined.json() as {result?:string;error?:string};if(!refined.ok||!refineTask.result)throw new Error(refineTask.error||'Could not start texturing.');const final=await pollTask(refineTask.result,value=>updateJob(job.id,{progress:50+Math.round(value/2)}));if(!final.assetUrl)throw new Error('Meshy returned no textured model.');addModel(final.assetUrl,job.prompt.slice(0,50));updateJob(job.id,{progress:100,status:'Added to scene'});
    }catch(error){updateJob(job.id,{status:'Failed',error:error instanceof Error?error.message:'3D generation failed.'});}
  };
  const generateModel=()=>{
    const prompt=modelPrompt.trim();if(!prompt)return;
    if(generationQuality==='low'){onPrompt(`Create a fast, lightweight editable draft of one ${prompt}. Use 6 to 12 local primitives, keep it centered near the origin, and do not change the rest of the scene.`);setNotice('Low-quality draft sent to nodepad. It uses local editable shapes and no Meshy credits.');setModelPrompt('');return;}
    const active=jobs.filter(job=>job.progress<100&&!job.error).length;if(active>=3){setNotice('Three models are already generating. Wait for one to finish.');return;}
    const job:GenerationJob={id:crypto.randomUUID(),prompt,quality:generationQuality,progress:0,status:'Queued'};setJobs(current=>[job,...current].slice(0,6));setModelPrompt('');void runApiJob(job);
  };
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(scene,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='scene.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <div className="stage-bg flex min-h-0 flex-1 flex-col">
    <div className="ink-bar flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto px-2 text-xs [scrollbar-width:none]">
      <button className={tb} onClick={undoMine}>Undo</button><button className={tb} onClick={redoMine}>Redo</button>
      <span className="mx-1 h-5 shrink-0 border-l border-line"/>
      {(['cube','sphere','cylinder','cone','torus','capsule'] as const).map(p=><button key={p} className={tb} onClick={()=>add(p)}>+ {p}</button>)}
      <button className={tb} onClick={()=>fileInput.current?.click()}>Import GLB</button><input ref={fileInput} type="file" accept=".glb,model/gltf-binary" className="hidden" onChange={e=>{void importModel(e.target.files?.[0]);e.target.value='';}}/>
      <span className="mx-1 h-5 shrink-0 border-l border-line"/>
      <div role="radiogroup" aria-label="Gizmo mode" className="flex shrink-0 overflow-hidden rounded-md border-[1.5px] border-[var(--ink)]">{(['translate','rotate','scale'] as const).map(m=><button key={m} role="radio" aria-checked={mode===m} className={cn('px-2 py-1 font-medium',mode===m?'bg-[var(--ink)] text-[var(--page)]':'bg-panel hover:bg-slate-100')} onClick={()=>setMode(m)}>{m==='translate'?'Move':m==='rotate'?'Rotate':'Resize'}</button>)}</div>
      <label className="ml-1 flex shrink-0 items-center gap-1 px-1"><input type="checkbox" className="accent-orb" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap</label>
      <label className="flex shrink-0 items-center gap-1 px-1">Mesh
        <select aria-label="Mesh quality" value={quality} onChange={e=>setQuality(e.target.value as typeof quality)} className="rounded-md border-[1.5px] border-line bg-white px-1.5 py-1 outline-none focus:border-[var(--ink)]">
          <option value="balanced">Balanced</option><option value="high">High</option><option value="ultra">Ultra</option>
        </select>
      </label>
      <div className="ml-auto flex shrink-0 pl-2"><button className={tb} onClick={()=>setReset(x=>x+1)}>Frame scene</button><button className={tb} onClick={download}>Export JSON</button></div>
    </div>
    <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
      <aside className="ink-page w-44 shrink-0 overflow-auto rounded-xl p-3 text-xs max-md:hidden">
        <h2 className={h2}>Scene objects ({scene.objects.length})</h2>
        <p className="mb-2 text-slate-500">Select an object to edit it. Ask nodepad below to build or change the scene.</p>
        {scene.objects.map(o=><button key={o.id} onClick={()=>setSelected(o.id)} className={cn('my-1 flex w-full items-center gap-2 rounded-md border-[1.5px] px-2 py-1.5 text-left',selected===o.id?'border-[var(--ink)] bg-orb/10 shadow-[2px_2px_0_var(--orb)]':'border-transparent hover:bg-slate-100')}><span className="size-2.5 shrink-0 rounded-full border border-[var(--ink)]" style={{background:o.color}}/><span className="truncate">{o.name}</span></button>)}
      </aside>
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border-[1.5px] border-[var(--ink)] shadow-[6px_6px_0_var(--ink)]"><SceneViewport scene={scene} selected={selected} onSelect={setSelected} mode={mode} snap={snap} reset={reset} quality={quality}/>
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border-[1.5px] border-[var(--ink)] bg-panel/90 px-3 py-1.5 text-xs text-slate-600 shadow-[2px_2px_0_var(--ink)]">Drag to orbit · Right drag to pan · Scroll to zoom<br/>Select an object, then drag its colored handles</div>
        {!scene.objects.length&&<div className="pointer-events-none absolute inset-x-6 bottom-6 rounded-xl border-[1.5px] border-[var(--ink)] bg-panel p-4 text-sm shadow-[4px_4px_0_var(--ink)]">Start with a shape above or describe an environment to nodepad below. <span className="hand text-[19px] text-orb">try “a cozy coffee shop with tables and plants”</span></div>}
      </div>
      <aside className="ink-page w-56 shrink-0 overflow-auto rounded-xl p-3 text-xs">
        <h2 className={h2}>Detailed AI model</h2>
        <textarea aria-label="Detailed 3D model prompt" value={modelPrompt} onChange={e=>setModelPrompt(e.target.value)} placeholder="A realistic modern lounge chair with curved wood arms and cream upholstery" className={cn(field,'h-20 resize-y p-2 placeholder:text-slate-400')}/>
        <select aria-label="AI model quality" value={generationQuality} onChange={e=>setGenerationQuality(e.target.value as GenerationQuality)} className={cn(field,'mt-2 p-2')}>
          <option value="low">Low · instant local draft</option><option value="medium">Medium · about 10 seconds</option><option value="high">High · textured, 2–3 minutes</option>
        </select>
        <button disabled={!modelPrompt.trim()||jobs.filter(job=>job.progress<100&&!job.error).length>=3} onClick={generateModel} className="ink-btn mt-2 w-full rounded-lg bg-orb px-2 py-2 font-semibold text-white disabled:opacity-40">Generate 3D model</button>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500">Low uses nodepad and local shapes. Medium and High use Meshy credits. Up to three API models can generate together.</p>
        {jobs.map(job=><div key={job.id} className="mt-2 rounded-lg border-[1.5px] border-[var(--ink)] bg-white p-2"><div className="flex justify-between gap-2"><span className="truncate font-medium">{job.prompt}</span><span className="font-mono">{job.progress}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full border border-[var(--ink)] bg-slate-100"><div className="h-full bg-orb transition-all" style={{width:`${job.progress}%`}}/></div><div className={job.error?'mt-1 text-red-600':'mt-1 text-slate-500'}>{job.error??job.status}</div></div>)}
        {notice&&<p role="status" className="mt-2 rounded-lg bg-orb/10 p-2 text-[var(--ink)]">{notice}</p>}
        <hr className="my-4 border-line"/>
        <h2 className={h2}>Object inspector</h2>
        {chosen?<div key={chosen.id}>
          <label className="block">Name<input aria-label="Object name" className={cn(field,'mb-3 mt-1')} defaultValue={chosen.name} key={chosen.name} onBlur={e=>edit({name:e.target.value})}/></label>
          {([['Position',['x','y','z']],['Rotation (degrees)',['rx','ry','rz']],['Axis scale',['sx','sy','sz']]] as const).map(([label,keys])=><fieldset key={label} className="mb-3"><legend className="mb-1 font-semibold">{label}</legend><div className="grid grid-cols-3 gap-1">{keys.map(k=><label key={k} className="text-slate-500">{k.replace(/^[rs]/,'').toUpperCase()}<input key={`${chosen.id}-${k}-${chosen[k]}`} aria-label={k} type="number" step={k.startsWith('r')?15:.1} defaultValue={Number(chosen[k].toFixed(3))} min={k.startsWith('s')?.05:undefined} max={k.startsWith('s')?100:undefined} onBlur={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v)&&(!k.startsWith('s')||(v>=.05&&v<=100)))edit({[k]:v});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} className={cn(field,'p-1 font-mono text-[var(--ink)]')}/></label>)}</div></fieldset>)}
          <label className="flex items-center justify-between font-semibold">Color<input type="color" aria-label="Object color" value={chosen.color} onChange={e=>edit({color:e.target.value})} className="h-7 w-10 cursor-pointer rounded border-[1.5px] border-[var(--ink)] bg-white"/></label>
          {chosen.primitive!=='model'&&<fieldset className="mt-4 border-t border-line pt-3"><legend className="pr-1 font-semibold">Sculpt shape</legend>
            {([['Bulge','bulge',-0.8,1.5,0.05],['Taper','taper',-0.9,0.9,0.05],['Twist','twist',-360,360,5]] as const).map(([label,key,min,max,step])=><label key={key} className="mt-2 block">{label} <span className="float-right font-mono text-slate-500">{chosen[key]}</span><input aria-label={label} type="range" min={min} max={max} step={step} value={chosen[key]} onChange={e=>edit({[key]:Number(e.target.value)})} className="w-full accent-orb"/></label>)}
            <div className="mt-3 grid grid-cols-2 gap-1.5"><button className={chip} onClick={()=>edit({sx:chosen.sx*1.12,sy:chosen.sy*1.12,sz:chosen.sz*1.12})}>Inflate</button><button className={chip} onClick={()=>edit({sy:chosen.sy*.75})}>Flatten</button><button className={cn(chip,'col-span-2')} onClick={()=>edit({bulge:0,taper:0,twist:0})}>Reset sculpt</button></div>
          </fieldset>}
          <div className="mt-4 flex items-center gap-2"><button className={chip} onClick={()=>{const id=crypto.randomUUID();commit({...chosen,type:'add_primitive',id,name:chosen.name+' copy',x:chosen.x+1.5});setSelected(id);}}>Duplicate</button><button className="rounded-md px-2 py-1 font-medium text-red-600 hover:bg-red-50" onClick={()=>{commit({type:'delete_primitive',id:chosen.id});setSelected(undefined);}}>Delete</button></div>
        </div>:<p className="hand text-[17px] leading-tight text-slate-500">click a shape or its name in the object list</p>}
        <hr className="my-4 border-line"/>
        <h2 className={h2}>Environment</h2>
        <label className="mb-2 flex items-center justify-between font-semibold">Sky<input aria-label="Sky color" type="color" value={env.sky} onChange={e=>commit({type:'set_environment',sky:e.target.value})} className="h-7 w-10 cursor-pointer rounded border-[1.5px] border-[var(--ink)] bg-white"/></label>
        <label className="mb-2 flex items-center justify-between font-semibold">Ground<input aria-label="Ground color" type="color" value={env.ground} onChange={e=>commit({type:'set_environment',ground:e.target.value})} className="h-7 w-10 cursor-pointer rounded border-[1.5px] border-[var(--ink)] bg-white"/></label>
        <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-orb" checked={env.grid} onChange={e=>commit({type:'set_environment',grid:e.target.checked})}/> Show grid</label>
      </aside>
    </div>
  </div>;
}
