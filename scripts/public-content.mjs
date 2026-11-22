const safeSlug=value=>typeof value==='string'&&value.length<=80&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const mediaPath=value=>typeof value==='string'&&/^\/media\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,160}$/.test(value);
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';

export function publicPosts(payload) {
  if(!Array.isArray(payload?.posts))throw Error('content/publications.json must contain a posts array.');
  const slugs=new Set();
  return payload.posts.map(post=>{
    if(!post||post.status!=='published'||post.deleted||!safeSlug(post.slug)||!['essay','video','note'].includes(post.kind))throw Error('Only published documents with valid URLs belong in the public content file.');
    if(slugs.has(post.slug))throw Error(`Duplicate document URL: ${post.slug}`);
    slugs.add(post.slug);
    const result={slug:post.slug,title:text(post.title,120),kind:post.kind,status:'published',summary:text(post.summary,320),body:text(post.body,400000),tags:Array.isArray(post.tags)?post.tags.filter(value=>typeof value==='string').slice(0,8).map(value=>value.slice(0,32)):[],attachments:[]};
    for(const key of ['createdAt','updatedAt','publishedAt'])if(typeof post[key]==='string'&&Number.isFinite(Date.parse(post[key])))result[key]=post[key];
    result.videoUrl=typeof post.videoUrl==='string'?post.videoUrl:null;
    if(result.videoUrl&&!mediaPath(result.videoUrl)) {
      let url;
      try {url=new URL(result.videoUrl);}catch {throw Error(`Invalid video URL on ${post.slug}.`);}
      if(url.protocol!=='https:'||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','vimeo.com','www.vimeo.com','player.vimeo.com'].includes(url.hostname))throw Error(`Invalid video URL on ${post.slug}.`);
    }
    for(const attachment of post.attachments || []) {
      if(!attachment||!mediaPath(attachment.url))throw Error(`Attachments on ${post.slug} must reference files in /media/.`);
      result.attachments.push({url:attachment.url,name:text(attachment.name,120),type:text(attachment.type,120),size:Number.isFinite(attachment.size)&&attachment.size>=0?attachment.size:0});
    }
    return result;
  });
}
