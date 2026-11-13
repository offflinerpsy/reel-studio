#!/usr/bin/env python3
"""Serve a local movie in a 360x640 phone review page; localhost only, HTTP Range."""
import argparse,html,json,re,shutil
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote,urlparse


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('project',type=Path);ap.add_argument('--movie',default='renders/final.mp4');ap.add_argument('--port',type=int,default=3033);args=ap.parse_args()
    project=args.project.resolve();movie=(project/args.movie).resolve()
    if project not in movie.parents or not movie.is_file():ap.error('Movie must exist inside this project')
    build=json.loads((project/'qa/build.json').read_text())
    buttons=''.join(f'<button onclick="v.pause();v.currentTime={s["sample"]}">{i+1}: {s["sample"]:.2f}s</button>' for i,s in enumerate(build['scenes']))
    page=f'''<!doctype html><meta charset="utf-8"><title>Kinetic phone review</title><style>body{{margin:20px;background:#242424;color:white;font:14px system-ui}}main{{display:flex;gap:24px;align-items:flex-start}}.phone{{position:relative;width:360px;height:640px;flex:none}}video{{width:360px;height:640px}}#safe{{position:absolute;left:35.33px;top:96.67px;width:252px;height:316.67px;outline:1px solid #fff8;box-shadow:0 0 0 400px #e6243833;pointer-events:none}}.phone{{overflow:hidden}}button{{padding:9px;margin:4px}}aside{{max-width:350px}}</style><h1>{html.escape(build['title'])}</h1><main><div class="phone"><video id="v" preload="auto" muted playsinline src="/{quote(movie.relative_to(project).as_posix())}"></video><div id="safe"></div></div><aside><button onclick="v.muted=true;v.play()">Play muted</button><button onclick="v.pause()">Pause</button><button onclick="safe.hidden=!safe.hidden">Toggle safe zone</button><p>{buttons}</p><output id="status"></output><p>360 × 640; tinted zones are QA overlays only.</p></aside></main><script>const v=document.querySelector('video'),safe=document.querySelector('#safe');setInterval(()=>document.querySelector('#status').textContent=`${{v.currentTime.toFixed(2)}} / ${{v.duration.toFixed(2)}} · paused=${{v.paused}}`,200);</script>'''.encode()
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*a,**kw):super().__init__(*a,directory=str(project),**kw)
        def log_message(self,*a):pass
        def send_head(self):
            self.request_range=None
            if urlparse(self.path).path=='/__review__':
                import io
                self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(page)));self.end_headers();return io.BytesIO(page)
            path=Path(self.translate_path(self.path));header=self.headers.get('Range')
            if header and path.is_file():
                size=path.stat().st_size;m=re.fullmatch(r'bytes=(\d+)-(\d*)',header)
                if not m or int(m[1])>=size:self.send_error(416);return None
                start=int(m[1]);end=min(int(m[2]) if m[2] else size-1,size-1)
                if end<start:self.send_error(416);return None
                f=path.open('rb');f.seek(start);self.request_range=(start,end)
                self.send_response(206);self.send_header('Content-Type',self.guess_type(str(path)));self.send_header('Accept-Ranges','bytes');self.send_header('Content-Range',f'bytes {start}-{end}/{size}');self.send_header('Content-Length',str(end-start+1));self.end_headers();return f
            return super().send_head()
        def copyfile(self,source,output):
            try:
                if self.request_range:
                    remaining=self.request_range[1]-self.request_range[0]+1
                    while remaining:
                        chunk=source.read(min(1024*1024,remaining))
                        if not chunk:break
                        output.write(chunk);remaining-=len(chunk)
                else:shutil.copyfileobj(source,output)
            except (BrokenPipeError,ConnectionResetError):pass
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    print(f'Phone review: http://127.0.0.1:{server.server_port}/__review__ (Ctrl-C to stop)',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':main()
