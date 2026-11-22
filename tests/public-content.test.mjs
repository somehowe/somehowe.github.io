import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPosts} from '../scripts/public-content.mjs';

const document={slug:'a-public-essay',status:'published',kind:'essay',title:'A public essay',summary:'A summary.',body:'Some writing.',tags:['systems'],publishedAt:'2026-11-22T00:00:00Z'};
test('public export projects an explicit field set and rejects unpublished records',()=>{
  const [post]=publicPosts({posts:[{...document,internalRecord:'not for export',etag:'private-revision',attachments:[{url:'/media/paper.pdf',name:'Paper',type:'application/pdf',size:12,key:'internal-storage-key'}]}]});
  assert.equal(post.internalRecord,undefined);assert.equal(post.etag,undefined);assert.equal(post.attachments[0].key,undefined);
  assert.equal(post.status,'published');assert.equal(post.body,'Some writing.');
  assert.throws(()=>publicPosts({posts:[{...document,status:'draft'}]}),/Only published/);
  assert.throws(()=>publicPosts({posts:[{...document,deleted:true}]}),/Only published/);
  assert.throws(()=>publicPosts({posts:[{...document,attachments:[{url:'/media/../../private.txt'}]}]}),/Attachments/);
});
