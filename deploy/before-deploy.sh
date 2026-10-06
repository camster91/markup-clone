#!/usr/bin/env bash
# Execute on the Docker host before a release build; never inside the app.
set -euo pipefail
umask 077
[[ ${1:-} =~ ^[a-z0-9]{20,40}$ ]] || { echo 'Invalid Coolify application ID' >&2; exit 2; }
install -d -m 700 /run/ashbi-docker-capacity
flock -x /run/ashbi-docker-capacity/maintenance.lock python3 - "$1" <<'PY'
import datetime, hashlib, json, pathlib, re, subprocess, sys, tarfile
def run(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True)
    if result.returncode: raise RuntimeError('Markup pre-deploy operation failed: '+args[0])
    return result.stdout
name=sys.argv[1]+'-app-1'
if subprocess.run(['docker','inspect',name],capture_output=True).returncode:
    name='markup-clone'
app=json.loads(run(['docker','inspect',name]))[0]
assert app['State']['Running'], 'The preceding app must be running for its backup'
mounts={m['Destination']:m for m in app['Mounts']}
for destination in ('/data/screenshots','/data/backups'):
    assert mounts[destination]['Type']=='bind'
    source=pathlib.Path(mounts[destination]['Source']).resolve()
    allowed=(source==pathlib.Path('/data/screenshots') or source.is_relative_to('/data/markup-clone') or source.is_relative_to('/opt/retired-deployments/markup-candidate'))
    assert allowed, 'Unexpected Markup storage source'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
relative='coolify/'+stamp
folder=pathlib.Path(mounts['/data/backups']['Source'])/relative
folder.mkdir(parents=True,mode=0o700)
folder.chmod(0o700)
dump_inside=run(['docker','exec','-e','BACKUP_DIR=/data/backups/'+relative,name,'bash','/opt/app-scripts/backup-postgres.sh']).decode().strip()
assert dump_inside.startswith('/data/backups/'+relative+'/markup-') and dump_inside.endswith('.dump')
dump=folder/pathlib.PurePosixPath(dump_inside).name
assert dump.is_file() and dump.stat().st_size>0
archive=folder/'screenshots.private.tar'
run(['tar','-cf',str(archive),'-C',mounts['/data/screenshots']['Source'],'.'])
with tarfile.open(archive) as saved:
    for member in saved.getmembers():
        assert member.isdir() or member.isfile(), 'Unexpected screenshot archive member'
        assert not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in pathlib.PurePosixPath(member.name).parts
        if member.isfile():
            relative_file=pathlib.PurePosixPath(member.name)
            current=pathlib.Path(mounts['/data/screenshots']['Source'])/relative_file
            assert hashlib.sha256(saved.extractfile(member).read()).digest()==hashlib.sha256(current.read_bytes()).digest(), 'Screenshot changed during backup'
source=app['Config']['Image']
assert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/:@-]*',source)
image=json.loads(run(['docker','image','inspect',source]))[0]
assert image['Id']==app['Image'], 'Preceding source image is unavailable or changed'
tag='ashbi-recovery/markup-app:'+stamp.lower()
definition=('FROM '+source+'\nLABEL coolify.managed="true" ashbi.retired="true" ashbi.recovery="markup"\n').encode()
run(['docker','build','--pull=false','--network=none','-t',tag,'-'],definition)
protected=json.loads(run(['docker','image','inspect',tag]))[0]
assert protected['RootFS']['Layers']==image['RootFS']['Layers']
checks={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (dump,archive)}
(folder/'recovery-proof.json').write_text(json.dumps({'checksums':checks,'precedingImage':image['Id'],'protectedImage':protected['Id'],'protectedTag':tag,'rootFSLayersMatch':True},indent=2))
print('Markup database catalog, screenshot archive and preceding image verified')
PY
