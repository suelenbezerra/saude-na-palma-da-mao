'use strict';
process.env.TZ='America/Recife';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{createApi}=require('./backend/api.cjs');
const root=path.join(__dirname,'dist'),port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const api=createApi();
const server=http.createServer((req,res)=>{
 let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end('Pedido inválido');return;}
 if(name.startsWith('/api/')){api(req,res);return;}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)||name.split('/').some(p=>p.startsWith('.')&&p!=='')){res.writeHead(403);res.end('Acesso indisponível');return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Arquivo não encontrado');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?undefined:data);
 });
});
server.requestTimeout=20000;server.headersTimeout=15000;
if(require.main===module){server.listen(port,host,()=>console.log(`Saúde na Palma: http://${host}:${port}`));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));}
module.exports=server;
