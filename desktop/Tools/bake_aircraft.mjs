// Export the project's authored aircraft geometry and sampled livery for native UE meshes.
// Run with node -r ./.pnp.cjs desktop/Tools/bake_aircraft.mjs from the repository root.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const dir = mkdtempSync(join(tmpdir(), 'sailing-aircraft-'));
const three = dirname(require.resolve('three'));
for (const name of ['three.module.js', 'three.core.js']) copyFileSync(join(three,name),join(dir,name));
copyFileSync(require.resolve('three/addons/utils/BufferGeometryUtils.js'),join(dir,'utils.js'));
const model = readFileSync('src/simulator/aircraft/AircraftModels.ts','utf8');
writeFileSync(join(dir,'model.js'),ts.transpileModule(model,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
writeFileSync(join(dir,'bake.html'),`<pre></pre><script type="importmap">{"imports":{"three":"./three.module.js","three/addons/utils/BufferGeometryUtils.js":"./utils.js"}}</script><script type="module">
import * as M from './model.js';import * as T from 'three';
const owned={geometries:[],materials:[],textures:[]};
const models={Floatplane:M.buildFloatplane({base:'#f9eee0',accent:'#d44320',trim:'#254650',registration:'LC-207'},owned),Airliner:M.buildAirliner(owned),StuntPlane:M.buildStuntPlane(owned)};
const output={};
for(const [name,parts] of Object.entries(models)){
 const group=parts.group;group.updateMatrixWorld(true);
 const vertices=[], faces=[], colors=[];
 group.traverse(mesh=>{
  if(!mesh.isMesh || mesh===parts.blurDisc || mesh.material.opacity<.5)return;
  const g=mesh.geometry,mat=mesh.material,base=vertices.length;
  const canvas=mat.map?.image;
  const pixels=canvas?.getContext?.('2d')?.getImageData(0,0,canvas.width,canvas.height).data;
  for(let i=0;i<g.attributes.position.count;i++){
    const v=new T.Vector3().fromBufferAttribute(g.attributes.position,i).applyMatrix4(mesh.matrixWorld);
    vertices.push([v.z,v.x,v.y]);
    const c=mat.color.clone();
    if(pixels&&g.attributes.uv){
      const u=g.attributes.uv.getX(i),v=g.attributes.uv.getY(i);
      const at=4*(Math.min(canvas.height-1,Math.floor((1-T.MathUtils.clamp(v,0,1))*canvas.height))*canvas.width+Math.min(canvas.width-1,Math.floor(T.MathUtils.clamp(u,0,1)*canvas.width)));
      c.multiply(new T.Color().setRGB(pixels[at]/255,pixels[at+1]/255,pixels[at+2]/255,T.SRGBColorSpace));
    }
    colors.push([c.r,c.g,c.b,1]);
  }
  const n=g.index?.count??g.attributes.position.count;
  for(let i=0;i<n;i+=3)faces.push([0,1,2].map(j=>base+(g.index?.getX(i+j)??(i+j))));
 });
 output[name]={vertices,faces,colors};
}
const banner=document.createElement('canvas');
banner.width=1024;banner.height=160;
const ink=banner.getContext('2d');
ink.fillStyle='#ffd43a';ink.fillRect(0,0,1024,160);
ink.strokeStyle='#c81e1e';ink.lineWidth=8;ink.strokeRect(8,8,1008,144);
ink.textAlign='center';ink.textBaseline='middle';ink.fillStyle='#a51b1d';
ink.font='900 84px Arial Black,Arial,sans-serif';ink.fillText('VOLCANO TOURS',512,62,960);
ink.font='bold 35px Arial,sans-serif';ink.fillStyle='#25202a';ink.fillText('BOOK YOUR FLIGHT TODAY',512,126,924);
output.banner=banner.toDataURL().split(',')[1];
document.querySelector('pre').textContent=JSON.stringify(output);
</script>`);
const html=execFileSync(process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 ['--headless','--disable-gpu','--disable-background-networking','--no-first-run','--allow-file-access-from-files',
  '--user-data-dir='+join(dir,'profile'),'--virtual-time-budget=5000','--dump-dom',pathToFileURL(join(dir,'bake.html')).href],
 {encoding:'utf8',maxBuffer:20*1024*1024});
const meshes=JSON.parse(html.match(/<pre>([^<]+)<\/pre>/)[1]);
writeFileSync(resolve('desktop/Saved/CoastalSources/T_FlightBanner.png'),Buffer.from(meshes.banner,'base64'));
delete meshes.banner;
writeFileSync(join(dir,'models.json'),JSON.stringify(meshes));
execFileSync(process.env.BLENDER_BIN||'/Applications/Blender.app/Contents/MacOS/Blender',['-b','-P',
 resolve('desktop/Tools/bake_aircraft.py'),'--',join(dir,'models.json')],{stdio:'inherit'});
