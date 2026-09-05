"""Regenerate HackVault's deterministic vector mark and raster icons (Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / 'icons'
ICON_DIR.mkdir(exist_ok=True)
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#3659c9"/><path d="M16 15h8v14h16V15h8v34h-8V37H24v12h-8z" fill="#fff"/><path d="m27 43 5 6 5-6" fill="none" stroke="#c6d4ff" stroke-width="3" stroke-linejoin="round"/></svg>'
(ICON_DIR/'favicon.svg').write_text(SVG+'\n')
def mark(size):
    scale=8
    im=Image.new('RGBA',(64*scale,64*scale))
    d=ImageDraw.Draw(im)
    def box(v): return tuple(x*scale for x in v)
    d.rounded_rectangle(box((0,0,64,64)),radius=13*scale,fill='#3659c9')
    d.polygon([(x*scale,y*scale) for x,y in [(16,15),(24,15),(24,29),(40,29),(40,15),(48,15),(48,49),(40,49),(40,37),(24,37),(24,49),(16,49)]],fill='white')
    d.line([(x*scale,y*scale) for x,y in [(27,43),(32,49),(37,43)]],fill='#c6d4ff',width=3*scale)
    return im.resize((size,size),Image.Resampling.LANCZOS)
for size,name in [(16,'favicon-16x16.png'),(32,'favicon-32x32.png'),(48,'favicon-48x48.png'),(180,'apple-touch-icon.png'),(192,'android-chrome-192x192.png'),(512,'android-chrome-512x512.png')]: mark(size).save(ICON_DIR/name)
mark(64).save(ICON_DIR/'favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])
im=Image.new('RGB',(1200,630),'#f7f8fa');d=ImageDraw.Draw(im)
font_path='/usr/share/fonts/noto/NotoSans-Regular.ttf'
bold_path='/usr/share/fonts/noto/NotoSans-Bold.ttf'
def font(n,bold=False):return ImageFont.truetype(bold_path if bold else font_path,n)
im.paste(mark(64),(72,64),mark(64));d.text((152,71),'HackVault',font=font(36,True),fill='#202530')
d.text((72,217),'Hackathon Problem',font=font(58,True),fill='#202530');d.text((72,291),'Statement Archive',font=font(58,True),fill='#202530')
d.text((76,399),'Search. Compare. Shortlist.',font=font(27),fill='#596575')
d.line((72,498,1128,498),fill='#d6dce0',width=2)
d.text((76,535),'SIH  /  Previous editions  /  Themes  /  Organizations',font=font(22),fill='#596575')
im.save(ROOT/'og-image.png',optimize=True)
