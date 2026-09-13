import http from 'node:http';
import {readFile} from 'node:fs/promises';
const types={html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml'};
http.createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(path.includes('..'))throw Error();const file=path==='/'?'index.html':path.slice(1);if(!/^(index.html|styles.css|app.js|core.js|db.js|sw.js|drive.js|google-config.js)$/.test(file))throw Error();res.setHeader('Content-Type',types[file.split('.').pop()]+'; charset=utf-8');res.end(await readFile(new URL(file,import.meta.url)));}catch{res.writeHead(404);res.end('Not found');}}).listen(Number(process.env.PORT)||3000,'0.0.0.0');
