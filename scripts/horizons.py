import json, sys, time, urllib.request, urllib.parse, datetime as dt
def vectors(cmd, start, stop, step):
    q = {"format":"json","COMMAND":f"'{cmd}'","EPHEM_TYPE":"VECTORS","CENTER":"'500@399'",
         "REF_PLANE":"FRAME","REF_SYSTEM":"ICRF","VEC_TABLE":"2","OUT_UNITS":"KM-S","CSV_FORMAT":"YES",
         "VEC_LABELS":"NO","OBJ_DATA":"NO","START_TIME":f"'{start}'","STOP_TIME":f"'{stop}'","STEP_SIZE":f"'{step}'","TIME_TYPE":"UT"}
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(q)
    for i in range(4):
        try:
            r = json.load(urllib.request.urlopen(url, timeout=90)); break
        except Exception as e:
            print("retry", cmd, e, file=sys.stderr); time.sleep(3*(i+1))
    txt = r["result"]
    if "$$SOE" not in txt: raise RuntimeError(txt[-800:])
    body = txt.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    out = []
    for line in body:
        p = [s.strip() for s in line.split(",")]
        jd = float(p[0]); x,y,z,vx,vy,vz = map(float, p[2:8])
        out.append([round((jd-2440587.5)*86400), round(x,1),round(y,1),round(z,1),round(vx,4),round(vy,4),round(vz,4)])
    return out
if __name__ == "__main__":
    now = dt.datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    S = (now - dt.timedelta(days=3)).strftime("%Y-%m-%d %H:%M"); E = (now + dt.timedelta(days=62)).strftime("%Y-%m-%d %H:%M")
    res = {"generated": now.isoformat()+"Z", "moon": vectors("301", S, E, "1h"), "sun": vectors("10", S, E, "6h"), "neos": {}}
    cad = json.load(open(sys.argv[1]))
    f = cad["fields"]
    for row in cad["data"]:
        r = dict(zip(f,row))
        if r["cd"] < (now - dt.timedelta(days=3)).strftime("%Y-%b-%d"): continue
        des = r["des"]
        try:
            coarse = vectors(f"DES={des};", S, E, "3h")
            ca = dt.datetime.strptime(r["cd"], "%Y-%b-%d %H:%M")
            fine = vectors(f"DES={des};", (ca-dt.timedelta(hours=14)).strftime("%Y-%m-%d %H:%M"), (ca+dt.timedelta(hours=14)).strftime("%Y-%m-%d %H:%M"), "20m")
            pts = {p[0]: p for p in coarse}
            for p in fine: pts[p[0]] = p
            res["neos"][des] = {"cad": r, "vec": [pts[k] for k in sorted(pts)]}
            print("ok", des, len(res["neos"][des]["vec"]), file=sys.stderr)
        except Exception as e:
            print("FAIL", des, str(e)[:300], file=sys.stderr)
        time.sleep(0.5)
    json.dump(res, open(sys.argv[2], "w"), separators=(",",":"))
