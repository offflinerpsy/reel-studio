"""Generate an original deterministic instrumental from reel.json; no songs/samples."""
from pathlib import Path
import argparse,json,math,re,subprocess
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('project',type=Path);args=ap.parse_args()
import numpy as np
import soundfile as sf
from scipy.signal import butter,sosfilt
project=args.project.resolve();spec=json.loads((project/'reel.json').read_text())
from build import validate
validate({k:v for k,v in spec.items() if k!='audio'},project)
SR=48000;BPM=spec['bpm'];BEAT=60/BPM;RATE=BEAT/.5
DURATION=sum(s['beats'] for s in spec['scenes'])*BEAT;N=round(SR*DURATION)
END=max(0,DURATION-4*BEAT)
out=project/'assets';out.mkdir(exist_ok=True)
if (out/'score.wav').exists() and not (out/'music-provenance.json').exists():
    raise SystemExit('Refusing to replace an existing untracked score.wav')
rng=np.random.default_rng(spec.get('seed',42))
drums=np.zeros((N,2),np.float32)
basses=np.zeros_like(drums);keys=np.zeros_like(drums)
pads=np.zeros_like(drums);accents=np.zeros_like(drums)
def time(d):return np.arange(round(d*SR),dtype=np.float64)/SR
def filt(x,cut,kind='lowpass',order=2):
    return sosfilt(butter(order,cut,btype=kind,fs=SR,output='sos'),x)
def place(bus,at,w,g=1,pan=0):
    i=round(at*SR)
    if i<0:return
    n=min(len(w),N-i)
    if n<=0:return
    angle=(pan+1)*np.pi/4
    bus[i:i+n,0]+=np.asarray(w[:n]*g*np.cos(angle),np.float32)
    bus[i:i+n,1]+=np.asarray(w[:n]*g*np.sin(angle),np.float32)
def hz(m):return 440*2**((m-69)/12)
def fade(t,d,attack=.004,release=.02):
    return np.minimum(1,t/attack)*np.minimum(1,np.maximum(0,d-t)/release)
def kick(at,velocity=1):
    t=time(.48)
    f=47+100*np.exp(-t*45)+35*np.exp(-t*155)
    phase=2*np.pi*np.cumsum(f)/SR
    body=np.sin(phase)*np.exp(-t*10.5)
    punch=.19*np.sin(phase*2)*np.exp(-t*35)
    click=filt(rng.normal(0,1,len(t)),[1600,5200],'bandpass')*.055*np.exp(-t*250)
    w=np.tanh((body+punch+click)*1.32)*fade(t,.48,.001,.02)
    place(drums,at,w,.52*velocity)
def clap(at,velocity=1):
    t=time(.24);noise=filt(rng.normal(size=len(t)),[950,6400],'bandpass')
    e=sum(np.where(t>=d,np.exp(-np.maximum(0,t-d)*160),0)*a for d,a in [(0,.7),(.011,.8),(.021,1),(.031,.75)])
    e+=.25*np.exp(-t*24)
    w=noise*e+.045*np.sin(2*np.pi*185*t)*np.exp(-t*30)
    place(drums,at,w,.105*velocity,-.12)
    place(drums,at+.014,w,.022*velocity,.42)
def hat(at,velocity=1,opened=False,pan=.25):
    d=.28 if opened else .073;t=time(d)
    n=filt(rng.normal(size=len(t)),[4300,12500],'bandpass')
    e=np.exp(-t*(18 if opened else 74))*fade(t,d,.001,.015)
    place(drums,at,n*e,.055*velocity,pan)
def shaker(at,velocity=1,pan=-.5):
    t=time(.066);n=filt(rng.normal(size=len(t)),[5600,13200],'bandpass')
    e=np.sin(np.pi*np.minimum(1,t/.018))**2*np.exp(-t*38)
    e+=.35*np.exp(-t*75)
    place(drums,at,n*e*fade(t,.066,.002,.017),.022*velocity,pan)
def conga(at,note=52,velocity=1,pan=.35):
    t=time(.16);f=hz(note)*2**(.25*np.exp(-t*45))
    p=2*np.pi*np.cumsum(f)/SR
    w=(np.sin(p)+.22*np.sin(p*1.5))*np.exp(-t*24)*fade(t,.16,.002,.035)
    place(drums,at,w,.06*velocity,pan)
def bass(at,note,d=.30,velocity=1):
    t=time(d);f=hz(note);p=2*np.pi*f*t
    # Additive pluck: rounded sub, short low-mid bite, no sharp saw top.
    w=np.sin(p)+.26*np.sin(p*2)*np.exp(-t*8)+.13*np.sin(p*3)*np.exp(-t*12)
    w+=.055*np.sin(p*4)*np.exp(-t*17)
    w=np.tanh(w*1.18)*np.exp(-t*2.3)*fade(t,d,.007,.042)
    place(basses,at,w,.24*velocity)
def epiano(at,notes,d=.95,velocity=1,pan=0):
    t=time(d+1.1);dur=d+1.1;w=np.zeros(len(t))
    for j,note in enumerate(notes):
        f=hz(note);detune=1+(j-len(notes)/2)*.00024
        mod=(.38+.32*velocity)*np.sin(2*np.pi*f*2*t)*np.exp(-t*5.4)
        tone=np.sin(2*np.pi*f*detune*t+mod)
        tone+=.13*np.sin(2*np.pi*f*2*t)*np.exp(-t*7)
        tone+=.05*np.sin(2*np.pi*f*3*t)*np.exp(-t*11)
        w+=tone*np.exp(-t*(2.25+j*.12))
    w=filt(w/max(len(notes),1),4600)*fade(t,dur,.006,.18)
    place(keys,at,w,.29*velocity,pan)
    place(keys,at+.375,w,.075*velocity,-pan+.12)
    place(keys,at+.75,w,.029*velocity,pan-.1)
def pad(at,notes,d=3.9,velocity=1):
    t=time(d);e=np.minimum(1,t/.38)*np.minimum(1,(d-t)/.75)
    for side,detune in [(-.62,.9987),(.62,1.0013)]:
        w=np.zeros(len(t))
        for note in notes:
            f=hz(note);w+=np.sin(2*np.pi*f*detune*t)+.16*np.sin(2*np.pi*f*2*t)
        w=filt(w/len(notes),1500)*e
        place(pads,at,w,.033*velocity,side)
def bell(at,note,velocity=.5,pan=.45):
    t=time(.9);f=hz(note)
    w=np.sin(2*np.pi*f*t+.45*np.sin(2*np.pi*f*2*t)*np.exp(-t*7))*np.exp(-t*4.5)*fade(t,.9,.009,.18)
    place(accents,at,w,.060*velocity,pan)
    place(accents,at+.375,w,.025*velocity,-pan)
def air(at,d=.45,velocity=1,reverse=False):
    t=time(d);w=filt(rng.normal(size=len(t)),[1500,8200],'bandpass')
    env=(t/d)**2 if reverse else np.exp(-t*9)
    w=w*env*fade(t,d,.01,.015)
    place(accents,at,w,.030*velocity,-.35);place(accents,at+.017,w,.023*velocity,.5)

chords=[[57,60,64,67,71],[53,57,60,64,67],[53,57,60,64,69],[55,59,62,64,67]]
roots=[33,29,38,40]
for bar in range(math.ceil(DURATION/(4*BEAT))):
    at=bar*4*BEAT;ci=(bar//2)%4;root=roots[ci];thin=DURATION*.4<=at<DURATION*.533
    intro=at<min(8*BEAT,DURATION*.15);ending=at>=END
    if ending:continue
    for beat in range(4):
        bt=at+beat*BEAT
        kick(bt,.9 if thin else 1)
        if beat%2:clap(bt,.72 if thin else .94)
        if not intro:
            hat(bt+BEAT/2, .70 if thin else 1,True,.25 if beat%2==0 else .4)
            hat(bt,.32 if thin else .50,False,-.25)
        if at>=8 and not thin:
            for sub in range(4):
                # Small late odd sixteenths create swing without shifting cuts.
                st=bt+sub*BEAT/4+(.014*RATE if sub%2 else 0)
                shaker(st,[.55,.32,1,.42][sub],-.5 if sub%2==0 else .4)
    if not intro:
        pattern=[(.27,0,.31,1),(.875,0,.24,.8),(1.27,0,.26,.93),(1.75,7,.20,.64)]
        if bar%2:pattern=[(.25,0,.34,1),(.94,12,.18,.48),(1.25,0,.31,.9),(1.81,-2,.15,.51)]
        if thin:pattern=pattern[:3]
        for off,interval,d,v in pattern:bass(at+off*RATE,root+interval,d*RATE,v)
    for off,v in [(0,.92),(.75,.53),(1.375,.72)]:
        if intro and off>0:continue
        if thin and off==.75:continue
        epiano(at+off*RATE,chords[ci],.85*RATE,v*(.82 if thin else 1),-.3 if off==0 else .32)
    if bar%2==0:pad(at,chords[ci][1:4],7.8*BEAT,.8 if thin else 1)
    if at>=8 and not thin and bar%2:
        conga(at+1.25*BEAT,52,.8,.42);conga(at+3.25*BEAT,57,.65,-.38)
    if bar%4==1:
        for off,note,v in [(.25,76,.60),(.875,74,.40),(1.5,71,.55)]:bell(at+off*RATE,note,v,.45 if off<1 else -.4)

at=0
for i,s in enumerate(spec['scenes']):
    if i:
        bell(at,69,.28,-.35)
        if i%2==0:air(at,.7,.8);air(max(0,at-BEAT),BEAT,.65,True)
    at+=s['beats']*BEAT
kick(END,.82);bass(END+.05,33,.9,.8)
epiano(END,[57,60,64,67,71],max(.5,DURATION-END-.6),1,-.15)
pad(END,[60,64,67,71],DURATION-END,.8)

# Sidechain the harmonic buses against the 4-on-the-floor kick.
t=np.arange(N,dtype=np.float64)/SR
phase=np.mod(t,BEAT)
duck=(1-.50*np.exp(-phase/(.23*BEAT))).astype(np.float32)
duck[t>=END]=1
basses*=duck[:,None];keys*=duck[:,None];pads*=duck[:,None]
# A small damped stereo room on the keys, not a wash across the drums.
dry=keys.copy()
for delay,gain in [(.071,.085),(.109,.060),(.163,.047),(.229,.031),(.337,.020),(.449,.014)]:
    k=round(delay*SR)
    keys[k:,0]+=dry[:-k,1]*gain
    keys[k:,1]+=dry[:-k,0]*gain
mix=drums+basses+keys+pads+accents
for ch in range(2):
    mix[:,ch]=filt(mix[:,ch],25,'highpass')
mix=np.tanh(mix*.92)
mix[:480]*=np.linspace(0,1,480)[:,None]
mix[-int(.6*SR):]*=np.linspace(1,0,int(.6*SR))[:,None]
peak=float(np.max(np.abs(mix)));mix*=.87/max(peak,1e-9)
raw=out/'score-raw.wav';sf.write(raw,mix,SR,subtype='PCM_24')
target='loudnorm=I=-16:TP=-3:LRA=7'
scan=subprocess.run(['ffmpeg','-hide_banner','-nostats','-i',str(raw),'-af',target+':print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
stats=json.loads(re.findall(r'\{[^{}]*\}',scan.stderr)[-1])
measured=':'.join(['measured_I='+stats['input_i'],'measured_TP='+stats['input_tp'],'measured_LRA='+stats['input_lra'],'measured_thresh='+stats['input_thresh'],'offset='+stats['target_offset'],'linear=true'])
subprocess.run(['ffmpeg','-v','error','-y','-i',str(raw),'-af',target+':'+measured,'-ar',str(SR),'-c:a','pcm_s24le',str(out/'score.wav')],check=True)
raw.unlink()
(out/'music-provenance.json').write_text(json.dumps({'title':spec['title']+' — original instrumental','duration_seconds':DURATION,'sample_rate':SR,'channels':2,'bpm':BPM,'seed':spec.get('seed',42),'source':'Original deterministic local synthesis; no external song, samples or voice','instruments':['four-on-the-floor kick','filtered-noise clap','swung hats/shaker','syncopated sub','FM electric piano','stereo pad','bell accents'],'mastering':{'target_lufs':-16,'target_true_peak':-3,'two_pass':True},'human_listening_review':False},indent=2)+'\n')
print(f'Rendered original instrumental: {DURATION:.3f}s / {BPM} BPM; set audio to assets/score.wav and rebuild.')
