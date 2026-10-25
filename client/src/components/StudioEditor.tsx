import { useRef, useState } from 'react';
import type { Studio, SceneObject } from '@hacktx/shared';
import { DEFAULT_ENVIRONMENT } from '@hacktx/shared';
import { commit } from '@/store/editor';
import { undoMine, redoMine } from '@/lib/actions';
import { SceneViewport } from './SceneViewport';

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
    for(let attempt=0;attempt<120;attempt++){await new Promise(resolve=>setTimeout(resolve,2000));const response=await fetch(`/api/studio/meshy/tasks/${encodeURIComponent(taskId)}`);const status=await response.json() as {status?:string;progress?:number;assetUrl?:string;error?:string};if(!response.ok)throw new Error(status.error||'Could not check generation.');onProgress(status.progress??0);if(status.status==='SUCCEEDED')return status;if(status.status==='FAILED'||status.status==='CANCELED')throw new Error(status.error||'3D generation failed.');}
    throw new Error('Generation is taking longer than expected.');
  };
  const runApiJob=async(job:GenerationJob)=>{
    try{
      updateJob(job.id,{status:'Building geometry'});const started=await fetch('/api/studio/meshy/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:job.prompt,quality:job.quality})});const task=await started.json() as {result?:string;error?:string};if(!started.ok||!task.result)throw new Error(task.error||'Could not start generation.');
      const preview=await pollTask(task.result,value=>updateJob(job.id,{progress:job.quality==='high'?Math.round(value/2):value}));
      if(job.quality==='medium'){if(!preview.assetUrl)throw new Error('Meshy returned no model file.');addModel(preview.assetUrl,job.prompt.slice(0,50));updateJob(job.id,{progress:100,status:'Added to scene'});return;}
      updateJob(job.id,{progress:50,status:'Adding PBR textures'});const refined=await fetch('/api/studio/meshy/refine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({previewTaskId:task.result,prompt:job.prompt})});const refineTask=await refined.json() as {result?:string;error?:string};if(!refined.ok||!refineTask.result)throw new Error(refineTask.error||'Could not start texturing.');const final=await pollTask(refineTask.result,value=>updateJob(job.id,{progress:50+Math.round(value/2)}));if(!final.assetUrl)throw new Error('Meshy returned no textured model.');addModel(final.assetUrl,job.prompt.slice(0,50));updateJob(job.id,{progress:100,status:'Added to scene'});
    }catch(error){updateJob(job.id,{status:'Failed',error:error instanceof Error?error.message:'3D generation failed.'});}
  };
  const generateModel=()=>{
    const prompt=modelPrompt.trim();if(!prompt)return;
    if(generationQuality==='low'){onPrompt(`Create a fast, lightweight editable draft of one ${prompt}. Use 6 to 12 local primitives, keep it centered near the origin, and do not change the rest of the scene.`);setNotice('Low-quality draft sent to Muse. It uses local editable shapes and no Meshy credits.');setModelPrompt('');return;}
    const active=jobs.filter(job=>job.progress<100&&!job.error).length;if(active>=3){setNotice('Three models are already generating. Wait for one to finish.');return;}
    const job:GenerationJob={id:crypto.randomUUID(),prompt,quality:generationQuality,progress:0,status:'Queued'};setJobs(current=>[job,...current].slice(0,6));setModelPrompt('');void runApiJob(job);
  };
  const download=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(scene,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='scene.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b bg-white p-2 text-xs">
      <button onClick={undoMine}>Undo</button><button onClick={redoMine}>Redo</button>
      {(['cube','sphere','cylinder','cone','torus','capsule'] as const).map(p=><button key={p} className="rounded border px-2 py-1" onClick={()=>add(p)}>+ {p}</button>)}
      <button className="rounded border px-2 py-1" onClick={()=>fileInput.current?.click()}>Import GLB</button><input ref={fileInput} type="file" accept=".glb,model/gltf-binary" className="hidden" onChange={e=>{void importModel(e.target.files?.[0]);e.target.value='';}}/>
      <span className="mx-1 border-l h-5"/>{(['translate','rotate','scale'] as const).map(m=><button key={m} className={`rounded px-2 py-1 ${mode===m?'bg-orange-500 text-white':'bg-slate-100'}`} onClick={()=>setMode(m)}>{m==='translate'?'Move':m==='rotate'?'Rotate':'Resize'}</button>)}
      <label><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap</label>
      <label className="flex items-center gap-1">Mesh quality
        <select aria-label="Mesh quality" value={quality} onChange={e=>setQuality(e.target.value as typeof quality)} className="rounded border bg-white px-2 py-1">
          <option value="balanced">Balanced</option><option value="high">High</option><option value="ultra">Ultra</option>
        </select>
      </label>
      <button onClick={()=>setReset(x=>x+1)}>Frame scene</button><button onClick={download}>Export JSON</button>
    </div>
    <div className="flex min-h-0 flex-1">
      <aside className="w-40 shrink-0 overflow-auto border-r bg-white p-3 text-xs max-md:hidden">
        <h2 className="font-bold">Scene objects ({scene.objects.length})</h2>
        <p className="my-2 text-slate-500">Select an object to edit it. Ask Muse below to build or change the scene.</p>
        {scene.objects.map(o=><button key={o.id} onClick={()=>setSelected(o.id)} className={`my-1 block w-full rounded p-2 text-left ${selected===o.id?'bg-orange-100':'bg-slate-50'}`}><span style={{color:o.color}}>● </span>{o.name}</button>)}
      </aside>
      <div className="relative min-w-0 flex-1"><SceneViewport scene={scene} selected={selected} onSelect={setSelected} mode={mode} snap={snap} reset={reset} quality={quality}/>
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-slate-950/75 px-3 py-2 text-xs text-white">Drag to orbit · Right drag to pan · Scroll to zoom<br/>Select an object, then drag its colored handles</div>
        {!scene.objects.length&&<div className="pointer-events-none absolute bottom-6 inset-x-6 rounded bg-white/90 p-4 text-sm">Start with a shape above or describe an environment to Muse below. Try “Build a cozy coffee shop with tables and plants.”</div>}
      </div>
      <aside className="w-48 shrink-0 overflow-auto border-l bg-white p-3 text-xs">
        <h2 className="mb-2 font-bold">Detailed AI model</h2>
        <textarea aria-label="Detailed 3D model prompt" value={modelPrompt} onChange={e=>setModelPrompt(e.target.value)} placeholder="A realistic modern lounge chair with curved wood arms and cream upholstery" className="h-20 w-full resize-y rounded border p-2"/>
        <select aria-label="AI model quality" value={generationQuality} onChange={e=>setGenerationQuality(e.target.value as GenerationQuality)} className="mt-2 w-full rounded border bg-white p-2">
          <option value="low">Low · instant local draft</option><option value="medium">Medium · about 10 seconds</option><option value="high">High · textured, 2–3 minutes</option>
        </select>
        <button disabled={!modelPrompt.trim()||jobs.filter(job=>job.progress<100&&!job.error).length>=3} onClick={generateModel} className="mt-2 w-full rounded bg-orange-500 px-2 py-2 font-semibold text-white disabled:opacity-50">Generate 3D model</button>
        <p className="mt-1 text-[10px] text-slate-500">Low uses Muse and local shapes. Medium and High use Meshy credits. Up to three API models can generate together.</p>
        {jobs.map(job=><div key={job.id} className="mt-2 rounded border bg-white p-2"><div className="flex justify-between gap-2"><span className="truncate font-medium">{job.prompt}</span><span>{job.progress}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-200"><div className="h-full bg-orange-500 transition-all" style={{width:`${job.progress}%`}}/></div><div className={job.error?'mt-1 text-red-600':'mt-1 text-slate-500'}>{job.error??job.status}</div></div>)}
        {notice&&<p role="status" className="mt-2 rounded bg-orange-50 p-2 text-orange-900">{notice}</p>}
        <h2 className="mb-3 font-bold">Object inspector</h2>
        {chosen?<div key={chosen.id}>
          <label>Name<input aria-label="Object name" className="mb-3 w-full border p-1" defaultValue={chosen.name} key={chosen.name} onBlur={e=>edit({name:e.target.value})}/></label>
          {([['Position',['x','y','z']],['Rotation (degrees)',['rx','ry','rz']],['Axis scale',['sx','sy','sz']]] as const).map(([label,keys])=><fieldset key={label} className="mb-3"><legend className="font-medium">{label}</legend><div className="grid grid-cols-3 gap-1">{keys.map(k=><label key={k}>{k.replace(/^[rs]/,'').toUpperCase()}<input key={`${chosen.id}-${k}-${chosen[k]}`} aria-label={k} type="number" step={k.startsWith('r')?15:.1} defaultValue={Number(chosen[k].toFixed(3))} min={k.startsWith('s')?.05:undefined} max={k.startsWith('s')?100:undefined} onBlur={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v)&&(!k.startsWith('s')||(v>=.05&&v<=100)))edit({[k]:v});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} className="w-full rounded border p-1"/></label>)}</div></fieldset>)}
          <label className="flex items-center justify-between">Color<input type="color" aria-label="Object color" value={chosen.color} onChange={e=>edit({color:e.target.value})}/></label>
          {chosen.primitive!=='model'&&<fieldset className="mt-4 border-t pt-3"><legend className="font-bold">Sculpt shape</legend>
            {([['Bulge','bulge',-0.8,1.5,0.05],['Taper','taper',-0.9,0.9,0.05],['Twist','twist',-360,360,5]] as const).map(([label,key,min,max,step])=><label key={key} className="mt-2 block">{label} <span className="float-right">{chosen[key]}</span><input aria-label={label} type="range" min={min} max={max} step={step} value={chosen[key]} onChange={e=>edit({[key]:Number(e.target.value)})} className="w-full accent-orange-500"/></label>)}
            <div className="mt-2 grid grid-cols-2 gap-1"><button className="rounded border p-1" onClick={()=>edit({sx:chosen.sx*1.12,sy:chosen.sy*1.12,sz:chosen.sz*1.12})}>Inflate</button><button className="rounded border p-1" onClick={()=>edit({sy:chosen.sy*.75})}>Flatten</button><button className="col-span-2 rounded border p-1" onClick={()=>edit({bulge:0,taper:0,twist:0})}>Reset sculpt</button></div>
          </fieldset>}
          <div className="mt-4 flex gap-2"><button className="rounded border px-2 py-1" onClick={()=>{const id=crypto.randomUUID();commit({...chosen,type:'add_primitive',id,name:chosen.name+' copy',x:chosen.x+1.5});setSelected(id);}}>Duplicate</button><button className="text-red-600" onClick={()=>{commit({type:'delete_primitive',id:chosen.id});setSelected(undefined);}}>Delete</button></div>
        </div>:<p className="text-slate-500">Click a shape or its name in the object list.</p>}
        <h2 className="mt-6 mb-3 font-bold">Environment</h2>
        <label className="flex justify-between mb-2">Sky<input aria-label="Sky color" type="color" value={env.sky} onChange={e=>commit({type:'set_environment',sky:e.target.value})}/></label>
        <label className="flex justify-between mb-2">Ground<input aria-label="Ground color" type="color" value={env.ground} onChange={e=>commit({type:'set_environment',ground:e.target.value})}/></label>
        <label><input type="checkbox" checked={env.grid} onChange={e=>commit({type:'set_environment',grid:e.target.checked})}/> Show grid</label>
      </aside>
    </div>
  </div>;
}
