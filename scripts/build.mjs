import {build} from 'esbuild';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projects} from '../src/reader/data.js';
import {publicPosts} from './public-content.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const docs=path.join(root,'docs');
const publicDir=path.join(root,'public');
const fromRoot=(...parts)=>path.join(root,...parts);
const safeSlug=slug=>typeof slug==='string'&&slug.length<=80&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

// A custom domain may be set by GitHub Pages after the initial build. Keep it
// through every rebuild rather than replacing it with a bundled hostname.
let cname;
for(const candidate of [path.join(docs,'CNAME'),path.join(publicDir,'CNAME')]) {
  try {cname=await readFile(candidate);break;}
  catch(error) {if(error.code!=='ENOENT')throw error;}
}

const publicationData=JSON.parse(await readFile(fromRoot('content/publications.json'),'utf8'));
const posts=publicPosts(publicationData);

await rm(docs,{recursive:true,force:true});
await mkdir(path.join(docs,'assets'),{recursive:true});
await cp(publicDir,docs,{recursive:true,filter:source=>path.basename(source)!=='CNAME'});
await cp(fromRoot('src/space/index.html'),path.join(docs,'index.html'));
await writeFile(path.join(docs,'publications.json'),JSON.stringify({posts},null,2)+'\n');
await writeFile(path.join(docs,'.nojekyll'),'');
if(cname)await writeFile(path.join(docs,'CNAME'),cname);

const mediaNames=new Set();
function includeMedia(value) {
  if(typeof value!=='string')return;
  const match=value.match(/^\/media\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,160})$/);
  if(match)mediaNames.add(match[1]);
}
for(const post of posts) {
  includeMedia(post.videoUrl);
  for(const attachment of post.attachments || [])includeMedia(attachment.url);
  for(const match of String(post.body || '').matchAll(/[\("'](\/media\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,160})(?=[\)"'\s])/g))includeMedia(match[1]);
}
if(mediaNames.size)await mkdir(path.join(docs,'media'),{recursive:true});
for(const name of mediaNames)await cp(fromRoot('content/media',name),path.join(docs,'media',name));

await build({
  absWorkingDir:root,
  entryPoints:{space:'src/space/main.js'},
  outdir:path.join(docs,'assets'),
  bundle:true,splitting:true,format:'esm',target:'es2022',minify:true,
  chunkNames:'scene/[name]-[hash]',external:['/assets/*'],logLevel:'warning'
});
await build({
  absWorkingDir:root,
  entryPoints:['src/reader/main.js'],
  outfile:path.join(docs,'assets/dossier.js'),
  bundle:true,minify:true,format:'esm',target:'es2022',
  external:['/assets/*'],assetNames:'fonts/[name]-[hash]',
  loader:{'.woff2':'file','.woff':'file','.ttf':'file'},logLevel:'warning'
});

const dossier=await readFile(fromRoot('src/reader/dossier.html'),'utf8');
await writeFile(path.join(docs,'dossier.html'),dossier);
const routes=new Map([['/work','Work'],['/practice','Practice'],['/about','About'],['/writing','Writing'],['/videos','Videos'],['/notes','Notes']]);
for(const project of projects) {
  if(!safeSlug(project.slug))throw Error('Invalid public project URL.');
  routes.set(`/work/${project.slug}`,project.title);
}
for(const post of posts) {
  routes.set(`/writing/${post.slug}`,post.title);
  if(post.kind==='video')routes.set(`/videos/${post.slug}`,post.title);
  if(post.kind==='note')routes.set(`/notes/${post.slug}`,post.title);
}
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
for(const [route,title] of routes) {
  const directory=path.join(docs,route.slice(1));
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'index.html'),dossier.replace(/<title>[^<]*<\/title>/,`<title>${escapeHtml(title)} · Ryan Howe</title>`));
}
console.log(`Built orbital home, ${routes.size} reader routes, and ${posts.length} published documents into docs/.`);
