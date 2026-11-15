import json, math, numpy as np
from PIL import Image, ImageFilter
import os; _ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); R=os.path.join(_ROOT,"raw"); O=os.path.join(_ROOT,"app")
# equatorial -> galactic (J2000)
Rm=np.array([[-0.0548755604,-0.8734370902,-0.4838350155],[0.4941094279,-0.4448296300,0.7469822445],[-0.8676661490,-0.1980763734,0.4559837762]])
def eq2gal(ra,dec):
    ra=np.radians(ra); dec=np.radians(dec)
    v=np.stack([np.cos(dec)*np.cos(ra),np.cos(dec)*np.sin(ra),np.sin(dec)],-1)
    g=v@Rm.T
    return np.degrees(np.arctan2(g[...,1],g[...,0]))%360, np.degrees(np.arcsin(np.clip(g[...,2],-1,1)))
GW,GH=2048,1024
lc=(np.arange(GW)+0.5)/GW*360; bc=90-(np.arange(GH)+0.5)/GH*180
M=json.load(open(f"{R}/mw.json"))
wts={"ol1":0.16,"ol2":0.2,"ol3":0.22,"ol4":0.22,"ol5":0.24}
gal=np.zeros((GH,GW),np.float32)
for ft in M["features"]:
    cross=[[] for _ in range(GW)]
    for ring in ft["geometry"]["coordinates"][0]:
        a=np.array(ring,float); l,b=eq2gal(a[:,0],a[:,1])
        n=len(l)
        for i in range(n):
            l1,b1=l[i],b[i]; l2,b2=l[(i+1)%n],b[(i+1)%n]
            dl=((l2-l1+540)%360)-180
            if abs(dl)<1e-9: continue
            lo=min(l1,l1+dl); hi=max(l1,l1+dl)
            c0=int(math.floor(lo/360*GW-0.5))+1; c1=int(math.floor(hi/360*GW-0.5))
            for c in range(c0,c1+1):
                lcc=(c+0.5)/GW*360
                t=(lcc-l1)/dl
                if 0<=t<1: cross[c%GW].append(b1+t*(b2-b1))
    mask=np.zeros((GH,GW),np.uint8)
    for c in range(GW):
        if not cross[c]: continue
        cb=np.sort(np.array(cross[c]))
        cnt=len(cb)-np.searchsorted(cb,bc,side="right")
        mask[:,c]=(cnt%2==1)*255
    gal+=np.asarray(Image.fromarray(mask).filter(ImageFilter.GaussianBlur(5)),np.float32)/255*wts[ft["id"]]
    print(ft["id"], mask.mean()/255)
# reproject to equatorial equirect
W,H=4096,2048
ra=(np.arange(W)+0.5)/W*360; dec=90-(np.arange(H)+0.5)/H*180
RA,DEC=np.meshgrid(ra,dec)
L,B=eq2gal(RA,DEC)
xi=np.clip((L/360*GW).astype(int),0,GW-1); yi=np.clip(((90-B)/180*GH).astype(int),0,GH-1)
acc=gal[yi,xi]
rng=np.random.default_rng(7)
def fbm(h,w,base=(8,16),oct=7):
    t=np.zeros((h,w),np.float32); a=1.0; s=0
    for o in range(oct):
        n=Image.fromarray((rng.random((base[0]*2**o,base[1]*2**o))*255).astype(np.uint8)).resize((w,h),Image.BICUBIC)
        t+=np.asarray(n,np.float32)/255*a; s+=a; a*=0.6
    return t/s
nz=fbm(H,W); nz2=fbm(H,W)
halo=0.09*np.exp(-(B/11.0)**2)*(0.6+0.8*np.clip(np.cos(np.radians(L)),0,1))+0.035*np.exp(-(B/30.0)**2)
glow=np.clip((acc+halo)*(0.6+1.1*(nz-0.5)),0,None)
lanes=np.clip((nz2-0.5)*3.5,0,1)
glow*=1-0.5*lanes*np.clip(acc*2.5,0,1)
gc=np.cos(np.radians(B))*np.cos(np.radians(L))
warm=np.clip((gc-0.3)/0.7,0,1)**1.6
g=np.clip(glow,0,1)
img=np.stack([g*(0.80+0.30*warm),g*(0.82+0.12*warm),g*(0.98-0.30*warm)],-1)
Image.fromarray(np.clip(img*255,0,255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)).save(f"{O}/tiles/milkyway.jpg",quality=84)
