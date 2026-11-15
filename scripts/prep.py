import json, math, re, datetime as dt, numpy as np
from PIL import Image, ImageDraw, ImageFilter
import os; _ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); R=os.path.join(_ROOT,"raw"); O=os.path.join(_ROOT,"app")
def tles(g):
    L=[l.rstrip() for l in open(f"{R}/{g}.tle") if l.strip()]
    out=[]
    for i in range(0,len(L)-2,3):
        if L[i+1].startswith("1 ") and L[i+2].startswith("2 "): out.append((L[i].strip(),L[i+1],L[i+2]))
    return out
def nid(t): return int(t[1][2:7])
sets={g:{nid(t) for t in tles(g)} for g in ["starlink","oneweb","gps-ops","glo-ops","galileo","beidou","geo","weather","science","stations"]}
objs={}
drop_modules=re.compile(r"^(ISS|CSS) \((?!ZARYA|TIANHE)|^POISK$")
for t in tles("active"):
    n=nid(t); name=t[0]
    if drop_modules.search(name): continue
    if n in (25544,48274): c="S"
    elif n in sets["starlink"]: c="L"
    elif n in sets["oneweb"] or re.match(r"^(KUIPER|QIANFAN|GUOWANG|HULIANWANG|SATNET|ESPRSA)",name): c="B"
    elif n in sets["gps-ops"]|sets["glo-ops"]|sets["galileo"]|sets["beidou"]: c="N"
    elif n in sets["geo"]: c="G"
    else: c="P"
    objs[n]=(c,name,t[1],t[2])
for g in ["cosmos-1408-debris","fengyun-1c-debris","iridium-33-debris","cosmos-2251-debris"]:
    for t in tles(g):
        n=nid(t)
        if n in objs: continue
        objs[n]=("R" if "R/B" in t[0] else "D", t[0], t[1], t[2])
from collections import Counter
print(Counter(v[0] for v in objs.values()), len(objs))
epochs=[]
with open(f"{O}/data/tle.txt","w") as f:
    for n,(c,name,l1,l2) in objs.items():
        f.write(f"{c}|{name}\n{l1}\n{l2}\n"); epochs.append(float(l1[18:32]))
# NEOs
H=json.load(open(f"{R}/horizons.json"))
neos=[]
for des,v in H["neos"].items():
    c=v["cad"]; h=float(c["h"])
    dmin=1329/math.sqrt(0.25)*10**(-h/5)*1000; dmax=1329/math.sqrt(0.05)*10**(-h/5)*1000
    neos.append({"des":des,"name":c["fullname"].strip(),"cd":c["cd"],"dist_au":float(c["dist"]),"v_rel":float(c["v_rel"]),"h":h,
                 "dmin":round(dmin,1),"dmax":round(dmax,1),"diameter":c["diameter"],"vec":v["vec"]})
json.dump({"generated":H["generated"],"moon":H["moon"],"sun":H["sun"],"neos":neos},open(f"{O}/data/ephemeris.json","w"),separators=(",",":"))
# stars
S=json.load(open(f"{R}/stars.6.json"))
stars=[]
for ft in S["features"]:
    lon,lat=ft["geometry"]["coordinates"]; p=ft["properties"]
    try: bv=float(p["bv"])
    except: bv=0.6
    stars.append([round(lon%360,3),round(lat,3),p["mag"],round(bv,2)])
json.dump(stars,open(f"{O}/data/stars.json","w"),separators=(",",":"))
# milky way texture, equirect RA 0..360 left->right, Dec +90 top
W,Hh=4096,2048
M=json.load(open(f"{R}/mw.json"))
acc=np.zeros((Hh,W),np.float32)
wts={"ol1":0.16,"ol2":0.2,"ol3":0.22,"ol4":0.22,"ol5":0.24}
def ring_xy(ring):
    pts=[]; prev=None; off=0
    for lon,lat in ring:
        x=lon%360
        if prev is not None:
            d=x+off-prev
            if d>180: off-=360
            elif d<-180: off+=360
        pts.append(((x+off)/360*W,(90-lat)/180*Hh)); prev=x+off
    return pts
for ft in M["features"]:
    m=Image.new("L",(W,Hh),0); dr=ImageDraw.Draw(m)
    for poly in ft["geometry"]["coordinates"]:
        for k,ring in enumerate(poly):
            pts=ring_xy(ring)
            for sh in (-W,0,W):
                dr.polygon([(x+sh,y) for x,y in pts],fill=255 if k==0 else 0)
    acc+=np.asarray(m.filter(ImageFilter.GaussianBlur(10)),np.float32)/255*wts[ft["id"]]
rng=np.random.default_rng(7)
def fbm(h,w,oct=6):
    t=np.zeros((h,w),np.float32); a=1.0; s=0
    for o in range(oct):
        sz=(max(2,w//(256>>o) if (256>>o)>0 else w), max(2,h//(256>>o) if (256>>o)>0 else h))
        n=Image.fromarray((rng.random((8*2**o,16*2**o))*255).astype(np.uint8)).resize((w,h),Image.BICUBIC)
        t+=np.asarray(n,np.float32)/255*a; s+=a; a*=0.55
    return t/s
nz=fbm(Hh,W)
nz2=fbm(Hh,W)
glow=acc*(0.55+0.9*(nz-0.5)) 
glow=np.clip(glow,0,None)
lanes=np.clip((nz2-0.48)*3,0,1)
glow*=1-0.45*lanes*np.clip(acc*2,0,1)
# galactic center tint
ra=np.linspace(0,360,W,endpoint=False)[None,:]; dec=np.linspace(90,-90,Hh)[:,None]
gc_ra,gc_dec=math.radians(266.4),math.radians(-28.94)
cosd=np.sin(np.radians(dec))*math.sin(gc_dec)+np.cos(np.radians(dec))*math.cos(gc_dec)*np.cos(np.radians(ra)-gc_ra)
warm=np.clip((cosd-0.2)/0.8,0,1)**1.5
g=np.clip(glow,0,1)
r=g*(0.78+0.35*warm); gg=g*(0.80+0.12*warm); b=g*(0.95-0.3*warm)
img=np.stack([r,gg,b],-1)
img=np.clip(img*255*0.9,0,255).astype(np.uint8)
Image.fromarray(img).filter(ImageFilter.GaussianBlur(1.5)).save(f"{O}/tiles/milkyway.jpg",quality=82)
# aurora
A=json.load(open(f"{R}/swpc_json_ovation_aurora_latest.json"))
grid=np.zeros((181,360),np.uint8)
for lon,lat,v in A["coordinates"]: grid[90-int(lat),int(lon)%360]=min(255,int(v*2.55*1.0))
Image.fromarray(grid).save(f"{O}/data/aurora.png")
# space weather
kp=json.load(open(f"{R}/swpc_products_noaa-planetary-k-index.json"))
wind=[w for w in json.load(open(f"{R}/swpc_json_rtsw_rtsw_wind_1m.json")) if w.get("active")]
mag=[w for w in json.load(open(f"{R}/swpc_json_rtsw_rtsw_mag_1m.json")) if w.get("active")]
def ds(rows,keys,step=15):
    rows=sorted(rows,key=lambda r:r["time_tag"])[-1440:]
    return [[r["time_tag"]]+[r.get(k) for k in keys] for i,r in enumerate(rows) if i%step==0 or i==len(rows)-1]
xr=[x for x in json.load(open(f"{R}/swpc_json_goes_primary_xrays-1-day.json")) if x["energy"]=="0.1-0.8nm"]
xr.sort(key=lambda x:x["time_tag"])
sc=json.load(open(f"{R}/swpc_products_noaa-scales.json"))["0"]
f107=sorted(json.load(open(f"{R}/swpc_json_f107_cm_flux.json")),key=lambda r:r["time_tag"])[-1]
sw={"fetched":dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),"kp":[[k["time_tag"],k["Kp"]] for k in kp],
    "wind":ds(wind,["proton_speed","proton_density","source"]),"mag":ds(mag,["bt","bz_gsm"]),
    "xray":[[x["time_tag"],x["flux"]] for i,x in enumerate(xr) if i%10==0 or i==len(xr)-1],
    "scales":{"R":sc["R"]["Scale"],"S":sc["S"]["Scale"],"G":sc["G"]["Scale"],"stamp":sc["DateStamp"]+"T"+sc["TimeStamp"]+"Z"},
    "f107":f107,"aurora":{"observed":A["Observation Time"],"forecast":A["Forecast Time"]},
    "tle_epoch_range":[min(epochs),max(epochs)]}
json.dump(sw,open(f"{O}/data/spaceweather.json","w"),separators=(",",":"))
# borders from topojson
T=json.load(open(f"{R}/countries-50m.json"))
sx,sy=T["transform"]["scale"]; tx,ty=T["transform"]["translate"]
lines=[]
for arc in T["arcs"]:
    x=y=0; pts=[]
    for dx,dy in arc:
        x+=dx; y+=dy; pts.append(round(x*sx+tx,3)); pts.append(round(y*sy+ty,3))
    lines.append(pts)
json.dump(lines,open(f"{O}/data/borders.json","w"),separators=(",",":"))
import shutil; shutil.copy(f"{R}/moon_1024.jpg",f"{O}/tiles/moon.jpg")
print(sw["scales"], sw["kp"][-1], sw["wind"][-1], sw["mag"][-1], sw["xray"][-1])
