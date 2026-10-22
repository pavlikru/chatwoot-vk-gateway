import json, subprocess, sys, threading, queue, time
from pathlib import Path
image=sys.argv[1]
fixture=json.loads(Path(sys.argv[2]).read_text())
assert fixture['synthetic'] is True
name='chatwoot-vk-candidate-process-20261022'
report={'image':image,'network':'none','passed':False}
logs=[]; stream=queue.Queue(); created=False; attached=None

def run(*args, check=True):
    p=subprocess.run(['docker',*args],capture_output=True,text=True,timeout=40)
    if check and p.returncode: raise RuntimeError(p.stderr)
    return p

def post(path, body, headers):
    args=['exec',name,'wget','-S','-O','-']
    for key,value in headers.items(): args.extend(['--header',key+': '+value])
    args.extend(['--post-data',body,'http://127.0.0.1:3000'+path])
    p=run(*args,check=False)
    return {'exit':p.returncode,'body':p.stdout,'status':p.stderr}

try:
    env={'NODE_ENV':'production','PORT':'3000','VK_MODE':'callback','VK_TOKEN':'synthetic-token','VK_CONFIRMATION':'synthetic-confirmation','VK_CALLBACK_SECRET':'synthetic-vk-secret','PUBLIC_URL':'https://gateway.example.invalid','CHATWOOT_URL':'https://chatwoot.example.invalid','CHATWOOT_ACCOUNT_ID':'4','CHATWOOT_INBOX_ID':'12','CHATWOOT_TOKEN':'synthetic-token','CHATWOOT_WEBHOOK_SECRET':fixture['secret']}
    cmd=['create','--platform','linux/amd64','--network','none','--memory','128m','--memory-swap','128m','--cpus','0.5','--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2','--name',name]
    for key,value in env.items():cmd.extend(['-e',key+'='+value])
    cmd.append(image);run(*cmd);created=True
    attached=subprocess.Popen(['docker','start','-a',name],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    def reader():
        for line in attached.stdout:logs.append(line);stream.put(line)
        stream.put(None)
    threading.Thread(target=reader,daemon=True).start()
    while True:
        line=stream.get(timeout=40)
        if line is None:raise RuntimeError('process exited before readiness')
        if 'gateway listening' in line:break
    assert json.loads(run('exec',name,'wget','-q','-O','-','http://127.0.0.1:3000/health').stdout)=={'status':'ok'}
    confirmation=post('/vk/callback',json.dumps({'type':'confirmation','secret':'synthetic-vk-secret'}),{'Content-Type':'application/json'})
    assert confirmation['exit']==0 and confirmation['body']=='synthetic-confirmation'
    signed=post('/chatwoot/webhook',fixture['raw_body'],fixture['headers'])
    assert signed['exit']==0 and json.loads(signed['body'])=={'status':'ok'}
    for path in ['/vk/callback','/chatwoot/webhook']:
        invalid=post(path,'{"synthetic":"body",',{'Content-Type':'application/json'})
        assert '400 Bad Request' in invalid['status']
    time.sleep(5)
    report['memory']={field:run('exec',name,'cat','/sys/fs/cgroup/'+field).stdout.strip() for field in ['memory.current','memory.peak','memory.max','memory.events','memory.swap.max','cpu.max']}
    assert report['memory']['memory.max']=='134217728'
    assert report['memory']['memory.swap.max']=='0'
    assert report['memory']['cpu.max']=='50000 100000'
    assert 'oom_kill 0' in report['memory']['memory.events']
    run('kill','--signal','SIGTERM',name)
    assert attached.wait(timeout=20)==0
    report['state']=json.loads(run('inspect','--format','{{json .State}}',name).stdout)
    assert report['state']['ExitCode']==0 and not report['state']['OOMKilled']
    assert 'shutting down' in ''.join(logs)
    for value in [fixture['secret'],fixture['headers']['X-Chatwoot-Signature'],'synthetic-vk-secret']:assert value not in ''.join(logs)
    report['checks']=['startup','health','VK confirmation','actual Trigger HMAC','malformed JSON both POST','5s idle sample','SIGTERM exit 0','no OOM']
    report['passed']=True
except BaseException as error:
    report['failure']=str(error)
finally:
    if created:
        report['finalState']=json.loads(run('inspect','--format','{{json .State}}',name).stdout)
        run('rm','-f',name,check=False)
    if attached is not None:
        try:attached.wait(timeout=5)
        except subprocess.TimeoutExpired:attached.terminate()
    report['logs']=logs
    print(json.dumps(report,ensure_ascii=False))
assert report['passed'], report.get('failure')
