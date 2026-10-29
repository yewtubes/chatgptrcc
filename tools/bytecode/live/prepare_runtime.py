#!/usr/bin/env python3
"""Fetch public, pinned test binaries into an explicitly isolated directory."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import zipfile

STUDIO='version-7062aec9dbe74b14'
WEB='version-75f1039cb4964863'
WINE='11.20~noble-1'
CHROME='151.0.7922.34'
REPO=Path(__file__).resolve().parents[3]

def get(url, out, size=None, md5=None, sha256=None):
    out=Path(out);out.parent.mkdir(parents=True,exist_ok=True)
    def valid():
        if not out.is_file() or (size is not None and out.stat().st_size!=size):return False
        if md5 and hashlib.md5(out.read_bytes()).hexdigest()!=md5:return False
        if sha256 and hashlib.sha256(out.read_bytes()).hexdigest()!=sha256:return False
        return out.stat().st_size>0
    if valid():return
    tmp=out.with_name(out.name+'.download')
    for attempt in range(3):
        try:
            subprocess.run(['curl','-fLsS','--retry','2','--max-time','180','--user-agent','Mozilla/5.0 Chrome/141.0.0.0',url,'-o',str(tmp)],check=True)
            tmp.replace(out)
            if not valid():raise ValueError('download verification failed: '+str(out))
            return
        except (subprocess.CalledProcessError,ValueError):
            if attempt==2:raise
            time.sleep(1)

def unzip(archive, directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            target=(directory/item.filename).resolve()
            if not target.is_relative_to(directory.resolve()):raise ValueError('unsafe archive path')
        z.extractall(directory)

def studio(root):
    pkg=root/'pkg';app=root/'app'
    get(f'https://setup.rbxcdn.com/{STUDIO}-rbxPkgManifest.txt',pkg/'manifest.txt')
    rows=(pkg/'manifest.txt').read_text().splitlines()[1:]
    dirs=dict(re.findall(r'\[([^\]]+\.zip)\]=([^\s]*)',(REPO/'tools/studio/install_studio.sh').read_text()))
    def one(i):
        name,md5,compressed,_=rows[i:i+4]
        get(f'https://setup.rbxcdn.com/{STUDIO}-{name}',pkg/name,int(compressed),md5)
        unzip(pkg/name,app/dirs[name]);print('studio',name,'verified',flush=True)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:list(pool.map(one,range(0,len(rows),4)))
    sha=hashlib.sha256((app/'RobloxStudioBeta.exe').read_bytes()).hexdigest()
    if sha!='781b36ed6fb62e61292b9e6a64327280c7da12b00f3ea8b2c91a3f4834f860ec':raise ValueError('Studio EXE fingerprint mismatch')
    (root/'version.json').write_text(json.dumps({'version':'0.745.0.7451137','clientVersionUpload':STUDIO,'bootstrapperVersion':''}))
    (app/'AppSettings.xml').write_text('<?xml version="1.0"?><Settings><ContentFolder>content</ContentFolder><BaseUrl>https://www.sitetest1.robloxlabs.com</BaseUrl></Settings>')
    print('Studio EXE SHA256',sha,flush=True)

def webclient():
    root=REPO/'webclient/live'/WEB;base=f'https://setup.rbxcdn.com/webclient/{WEB}-RobloxWebClient'
    for name in ['WebClient.wasm','WebClient.js','WasmPlayer.js','WebClient.metadata.json','audio-processor-fast.js']:get(base+'/'+name,root/name)
    sha=hashlib.sha256((root/'WebClient.wasm').read_bytes()).hexdigest()
    if sha!='d72c52618f5c153c9b17a97e644914d43918c7122d754d96f79e8323acc6a15d':raise ValueError('WebClient fingerprint mismatch')
    items=json.loads((root/'WebClient.metadata.json').read_text())
    def one(item):get(base+urllib.parse.quote(item['path']),root/item['path'].lstrip('/'),item['size'])
    with concurrent.futures.ThreadPoolExecutor(16) as pool:list(pool.map(one,items))
    (root/'client-version.json').write_text(json.dumps({'version':'0.745.0.7451145','clientVersionUpload':WEB,'bootstrapperVersion':''}))
    print('Verified',len(items),'WebClient content files; wasm',sha,flush=True)

def wine(root):
    index=root/'wine-Packages';get('https://dl.winehq.org/wine-builds/ubuntu/dists/noble/main/binary-amd64/Packages',index)
    entries=index.read_text().split('\n\n')
    for name in ['wine-staging','wine-staging-amd64']:
        entry=next(x for x in entries if x.startswith('Package: '+name+'\n') and '\nVersion: '+WINE+'\n' in x)
        fields=dict(line.split(': ',1) for line in entry.splitlines() if ': ' in line and not line.startswith(' '))
        dest=root/Path(fields['Filename']).name
        get('https://dl.winehq.org/wine-builds/ubuntu/'+fields['Filename'],dest,int(fields['Size']),sha256=fields['SHA256'])
        subprocess.run(['dpkg-deb','-x',str(dest),str(root/'wine')],check=True)
    print('Verified Wine Staging',WINE,flush=True)

def chrome(root):
    dest=root/'chrome.zip'
    get(f'https://storage.googleapis.com/chrome-for-testing-public/{CHROME}/linux64/chrome-headless-shell-linux64.zip',dest)
    unzip(dest,root/'chrome')
    for p in (root/'chrome').rglob('*'):
        if p.name in ['chrome-headless-shell','chrome_crashpad_handler']:p.chmod(0o755)
    print('Chrome archive CRC verified',CHROME,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('component',choices=['studio','webclient','wine','chrome']);p.add_argument('directory',type=Path)
    a=p.parse_args();a.directory.mkdir(parents=True,exist_ok=True)
    if a.component=='webclient':webclient()
    else:globals()[a.component](a.directory.resolve())
