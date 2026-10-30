#!/usr/bin/env python3
"""Run the real Studio/WebClient test in a disposable, independent runner."""
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[3]
RUNTIME=ROOT/'.live-runtime'
OUT=Path(os.environ['EVIDENCE_DIR']).resolve()
STUDIO=Path(os.environ['STUDIO_DIR']).resolve()
if not STUDIO.is_relative_to(RUNTIME) or not Path(os.environ['DATA_DIR']).resolve().is_relative_to(RUNTIME):
    raise SystemExit('refusing to use a Studio prefix/database outside this checkout runtime')
OUT.mkdir(parents=True,exist_ok=True)
env=dict(os.environ,WINEPREFIX=str(STUDIO/'prefix'),WINEARCH='win64',WINEDEBUG='-all',WINEDLLOVERRIDES='mscoree,mshtml=',
         STUDIO_BACKEND_LOG=str(OUT/'studio-backend.log'),LOCAL_RCC_LOG='Z:'+str(OUT/'compiler.log'),LOCAL_RCC_AUDIT_DIR='Z:'+str(OUT/'sender'),
         RCC_HOST='127.0.0.1',RCC_PORT='53680',PLACE_ID='1818',STUDIO_PLACE_ID='1818',LP_NUM_THREADS='1')
env['STUDIO_WINEDEBUG']='-all,err+all,warn+module,warn+seh'
env['STUDIO_OAUTH_USER']='Builder'
cpus=sorted(os.sched_getaffinity(0));split=max(1,len(cpus)//2)
env['STUDIO_CPUS']=','.join(map(str,cpus[:split]));browser_cpus=cpus[split:] or cpus[:1]
username=getpass.getuser()
logs=STUDIO/'prefix/drive_c/users'/username/'AppData/Local/Roblox/logs'
env['STUDIO_LOGS']=str(logs)
processes=[];files=[]

def run(args,timeout=90,**kwargs):
    return subprocess.run(args,cwd=ROOT,env=env,check=True,timeout=timeout,**kwargs)

def start(args,log):
    file=open(OUT/log,'wb');files.append(file)
    p=subprocess.Popen(args,cwd=ROOT,env=env,stdout=file,stderr=subprocess.STDOUT,start_new_session=True)
    processes.append(p);return p

def readlog(name):
    p=OUT/name;return p.read_text(errors='replace') if p.exists() else ''

def fixtures():
    tree=ET.parse(ROOT/'places/Baseplate.rbxlx');root=tree.getroot()
    player=ET.SubElement(root,'Item',{'class':'StarterPlayer','referent':'AUDIT_SP'})
    scripts=ET.SubElement(player,'Item',{'class':'StarterPlayerScripts','referent':'AUDIT_SPS'})
    sources={
        'BytecodeAuditSmall':'print("ROBLUC_BYTECODE_AUDIT_SMALL")',
        'BytecodeAuditLarge':'local value = "\\0\\255'+('original-client-integrity-test-'*100)+'"\nprint("ROBLUC_BYTECODE_AUDIT_LARGE", value)',
    }
    for name,source in sources.items():
        item=ET.SubElement(scripts,'Item',{'class':'LocalScript','referent':name});props=ET.SubElement(item,'Properties')
        ET.SubElement(props,'string',{'name':'Name'}).text=name
        ET.SubElement(props,'ProtectedString',{'name':'Source'}).text=source
        (OUT/(name+'.lua')).write_text(source)
    observer=ET.SubElement(root,'Item',{'class':'ServerScriptService','referent':'AUDIT_SSS'})
    script=ET.SubElement(observer,'Item',{'class':'Script','referent':'AUDIT_OBSERVER'})
    props=ET.SubElement(script,'Properties')
    ET.SubElement(props,'string',{'name':'Name'}).text='BytecodeAuditPositionObserver'
    ET.SubElement(props,'ProtectedString',{'name':'Source'}).text='''
while task.wait(0.25) do
    for _, player in game:GetService("Players"):GetPlayers() do
        local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
        if root then
            local p = root.Position
            print(string.format("ROBLUC_POSITION|%s|%.0f|%.4f|%.4f|%.4f", player.Name, DateTime.now().UnixTimestampMillis, p.X, p.Y, p.Z))
        end
    end
end
'''
    target=RUNTIME/'audit-place.rbxlx';tree.write(target,encoding='utf-8',xml_declaration=True)
    return target

result={'live_join_run':False,'controls_fixed':False,'webclient_modified':False,'runtime':'Wine Staging 11.20 / Studio 0.745.0.7451137'}
try:
    run(['sudo','sysctl','-w','net.ipv4.ip_unprivileged_port_start=0'],stdout=subprocess.DEVNULL)
    for port in (443,18080,53680):
        with socket.socket() as s:s.bind(('127.0.0.1',port))
    # Name routing is confined to this fresh GitHub runner VM, never a shared project machine.
    setup=(ROOT/'tools/studio/setup_env.sh').read_text()
    services=re.search(r'services="([^"]+)"',setup,re.S)[1].split()
    names=['sitetest1.robloxlabs.com']+[s+'.sitetest1.robloxlabs.com' for s in services]+['ephemeralcounters.api.sitetest1.robloxlabs.com','upload.crashes.rbxinfra.com']
    run(['sudo','tee','-a','/etc/hosts'],input=('\n# independent Robluc CI\n127.0.0.1 '+' '.join(names)+'\n').encode(),stdout=subprocess.DEVNULL)
    display=start(['Xvfb',env.get('DISPLAY',':97'),'-screen','0','1280x800x24','-nolisten','tcp','-ac'],'xvfb.log')
    time.sleep(2)
    if display.poll() is not None:raise RuntimeError('isolated Xvfb failed')
    with open(OUT/'wineboot.log','wb') as f:run(['wineboot','-i'],timeout=120,stdout=f,stderr=subprocess.STDOUT)
    run(['wineserver','-w'],timeout=120)
    with open(OUT/'wine-paths.log','wb') as f:
        run(['wine','cmd','/c','echo %USERNAME% %LOCALAPPDATA%'],stdout=f,stderr=subprocess.STDOUT)
    run(['tools/studio/make_tls.sh'],stdout=subprocess.DEVNULL)
    with open(STUDIO/'app/ssl/cacert.pem','ab') as f:f.write(b'\nLocal Roblox Backend CA\n'+(ROOT/'backend-tls/ca.crt').read_bytes())
    run(['node','-e',"require('./tools/backend/db.js').open()"],stdout=subprocess.DEVNULL)
    api=start(['node','tools/studio_backend.js'],'backend-process.log')
    time.sleep(2)
    server_command=['tools/studio/run_server.sh',str(fixtures()),'53680']
    server=start(server_command,'studio-launch.log')
    started=time.monotonic()
    clicked=False;login_completed=None;restarted=False
    while time.monotonic()-started<260:
        if server.poll() is not None:raise RuntimeError('Studio server exited; see studio-launch.log')
        if 'run_server: registered job ' in readlog('studio-launch.log'):break
        elapsed=time.monotonic()-started
        if 'oauth: authorization_code -> tokens for Builder' in readlog('backend-process.log') and login_completed is None:
            login_completed=time.monotonic()
            result.setdefault('local_studio_login',{'backend_user':'Builder'})['token_exchange_completed']=True
        if not clicked and login_completed is None and elapsed>15 and '/oauth/v1/authorize' in readlog('studio-backend.log'):
            # Observed on the pinned build's 1280x800 Wine desktop. The existing
            # xdg-open helper completes OAuth against this checkout's backend.
            run(['scrot',str(OUT/'studio-before-local-login.png')])
            run(['xdotool','mousemove','749','460','click','1'])
            clicked=True
            result['local_studio_login']={'backend_user':'Builder','browser_button_clicked':True}
        if login_completed and not restarted and time.monotonic()-login_completed>45:
            # Some Studio login flows consume the original launch intent. Retry
            # the same server command after persisting this prefix's own login.
            os.killpg(server.pid,signal.SIGTERM)
            run(['wineserver','-k'],timeout=20)
            run(['wineserver','-w'],timeout=20)
            (OUT/'studio-before-restart.log').write_text(readlog('studio-launch.log'))
            server=start(server_command,'studio-launch.log')
            restarted=True
            result['local_studio_login']['server_restarted_after_login']=True
        time.sleep(2)
    else:raise RuntimeError('Studio did not register RbxTransport within 260 seconds')
    for capture in ((True,) if env.get('PLAYERMODULE_TRACE_ONLY') else (False,True)):
        label='capture' if capture else 'baseline'
        command=['taskset','-c',','.join(map(str,browser_cpus)),'node','tools/bytecode/live/browser_run.js']+(['--capture'] if capture else [])
        browser=start(command,label+'-process.log')
        deadline=time.monotonic()+240
        while browser.poll() is None:
            if server.poll() is not None:raise RuntimeError('Studio exited during '+label+' browser run')
            if time.monotonic()>deadline:
                os.killpg(browser.pid,signal.SIGTERM);raise RuntimeError(label+' browser timed out')
            time.sleep(0.5)
        code=browser.returncode
        if code:raise RuntimeError(label+' browser failed; see logs')
        text=readlog(label+'-browser.log')
        result[label]={'replicator_created':bool(re.search(r'Replicator created',text,re.I)),
                       'player_module_corrupted':bool(re.search(r'PlayerModule[^\n]*bytecode corrupted',text)),
                       'small_probe_executed':'ROBLUC_BYTECODE_AUDIT_SMALL' in text,
                       'large_probe_executed':'ROBLUC_BYTECODE_AUDIT_LARGE' in text,
                       'bytecode_errors':sorted(set(re.findall(r'[^\n]*bytecode corrupted[^\n]*',text)))}
        if not result[label]['replicator_created']:raise RuntimeError(label+' did not reach Replicator creation')
    result['live_join_run']=True
    receiver=OUT/'receiver.jsonl';sender={}
    for file in (OUT/'sender').glob('*.bc'):
        content=file.read_bytes();digest=hashlib.sha256(content).hexdigest();sender.setdefault(digest,[]).append(file.name)
    rows=[json.loads(line) for line in receiver.read_text().splitlines()] if receiver.exists() else []
    for row in rows:row['matching_sender_files']=sender.get(row['sha256'],[])
    result['received_bytecode']=rows
    result['full_payload_matches']=sum(bool(row['matching_sender_files']) for row in rows)
    if not result.get('baseline',result.get('capture',{})).get('replicator_created'):raise RuntimeError('client did not reach Replicator creation')
    if not rows:raise RuntimeError('no actual VM loader captures recorded')
except Exception as error:
    result['failure']=str(error)
    raise
finally:
    with open(OUT/'processes.log','wb') as f:
        subprocess.run(['ps','-eo','pid,ppid,stat,etime,args'],stdout=f,check=False)
    subprocess.run(['scrot',str(OUT/'studio-desktop.png')],env=env,timeout=20,check=False)
    for p in reversed(processes):
        if p.poll() is None:
            try:os.killpg(p.pid,signal.SIGTERM)
            except ProcessLookupError:pass
    subprocess.run(['wineserver','-k'],env=env,cwd=ROOT,timeout=20,check=False)
    # Wine user names can differ from the runner account; collect only this prefix.
    for file in (STUDIO/'prefix/drive_c/users').glob('*/AppData/Local/Roblox/**/*.log'):
        (OUT/('studio-'+file.name)).write_bytes(file.read_bytes())
    input_file=OUT/'baseline-input.json'
    if input_file.exists():
        window=json.loads(input_file.read_text());positions=[]
        for file in OUT.glob('studio-*.log'):
            for name,stamp,x,y,z in re.findall(r'ROBLUC_POSITION\|([^|\r\n]+)\|(\d+)\|(-?[\d.]+)\|(-?[\d.]+)\|(-?[\d.]+)',file.read_text(errors='replace')):
                if name=='AuditBaseline' and window['start']-500 <= int(stamp) <= window['end']+500:
                    positions.append((int(stamp),float(x),float(y),float(z)))
        positions.sort()
        distance=max(((p[1]-positions[0][1])**2+(p[3]-positions[0][3])**2)**0.5 for p in positions) if positions else 0
        result['movement']={'input':window,'server_positions':positions,'horizontal_displacement_studs':distance}
        baseline=result.get('baseline',{})
        result['controls_fixed']=bool(baseline.get('small_probe_executed') and not baseline.get('player_module_corrupted') and distance>1)
    file=ROOT/'webclient/live/version-75f1039cb4964863/WebClient.wasm'
    if file.exists():result['webclient_sha256_after']=hashlib.sha256(file.read_bytes()).hexdigest()
    (OUT/'live-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2),flush=True)
    for file in files:file.close()
