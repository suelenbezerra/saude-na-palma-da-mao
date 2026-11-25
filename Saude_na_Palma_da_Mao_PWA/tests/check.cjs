const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist');
for(const file of ['index.html','manifest.json','sw.js','css/style.css','js/app.js','js/data.js','js/store.js','js/views.js','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'])assert(fs.existsSync(path.join(dist,file)),file);
const manifest=JSON.parse(fs.readFileSync(path.join(dist,'manifest.json'),'utf8'));
for(const key of ['id','name','short_name','start_url','scope','display','theme_color','background_color','icons'])assert(manifest[key],key);
assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons){const b=fs.readFileSync(path.join(dist,icon.src));assert.equal(b.readUInt32BE(16),Number(icon.sizes.split('x')[0]));assert.equal(b.readUInt32BE(20),Number(icon.sizes.split('x')[1]));}
assert(fs.readFileSync(path.join(dist,'index.html'),'utf8').includes('rel="manifest"'));
for(const f of ['./js/views.js','./js/demo-store.js'])assert(fs.readFileSync(path.join(dist,'sw.js'),'utf8').includes(f),'Todas as dependências offline devem estar no cache');
for(const f of ['sw.js','js/app.js','js/data.js','js/store.js','js/demo-store.js','js/views.js'])execFileSync(process.execPath,['--check',path.join(dist,f)],{stdio:'pipe'});
console.log('Estrutura, manifest, dimensões dos ícones, recursos offline e sintaxe conferidos.');
