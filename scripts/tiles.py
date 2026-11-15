from PIL import Image, ImageFilter
import os, numpy as np
Image.MAX_IMAGE_PIXELS = None
import os; _ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); R = os.path.join(_ROOT, "raw"); OUT = os.path.join(_ROOT, "app")
def stitch(d, cols, rows, ext, ts=512):
    im = Image.new("RGB", (cols*ts, rows*ts))
    for r in range(rows):
        for c in range(cols):
            t = Image.open(f"{R}/{d}/{r}_{c}.{ext}").convert("RGB")
            im.paste(t, (c*ts, r*ts))
    return im
def pyramid(img, name, maxL, q):
    for L in range(maxL+1):
        W = 1024 * 2**(L+1); H = W//2
        lv = img.resize((W, H), Image.LANCZOS) if img.size != (W,H) else img
        d = f"{OUT}/tiles/{name}/{L}"; os.makedirs(d, exist_ok=True)
        for y in range(2**L):
            for x in range(2**(L+1)):
                lv.crop((x*1024, y*1024, (x+1)*1024, (y+1)*1024)).save(f"{d}/{x}_{y}.jpg", quality=q, optimize=True, progressive=False)
        print(name, L, W)
bm = stitch("bm", 40, 20, "jpg")
print("bm", bm.size)
pyramid(bm, "bm", 3, 82)
g = bm.resize((4096, 2048), Image.LANCZOS); g.save(f"{OUT}/tiles/bm_global.jpg", quality=85)
a = np.asarray(g).astype(np.int16)
r,gg,b = a[...,0],a[...,1],a[...,2]
water = ((b > r + 8) & (b >= gg - 4) & (r < 70) & (gg < 95)).astype(np.uint8)*255
Image.fromarray(water).filter(ImageFilter.GaussianBlur(1.2)).save(f"{OUT}/tiles/water.png", optimize=True)
del bm
night = stitch("night", 10, 5, "png").resize((4096, 2048), Image.LANCZOS)
night.save(f"{OUT}/tiles/night.jpg", quality=85)
vi = stitch("viirs", 20, 10, "jpg")
pyramid(vi, "viirs", 2, 80)
