"""Recover only source-locked public speech inputs; never execute package scripts."""
from pathlib import Path,PurePosixPath
import argparse,json,hashlib,base64,urllib.request,urllib.parse,tarfile,os

def digest(raw):return hashlib.sha256(raw).hexdigest()
def fetch(url,limit):
 parsed=urllib.parse.urlsplit(url)
 if parsed.scheme!='https' or parsed.hostname not in {'registry.npmjs.org','huggingface.co'} or parsed.username or parsed.query:raise ValueError('Unsupported locked public URL')
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'WebOS-Speech-Input-Recovery/1'}),timeout=90) as response:raw=response.read(limit+1)
 except Exception as error:raise RuntimeError('Public input fetch failed: '+type(error).__name__) from None
 if len(raw)>limit:raise ValueError('Locked input limit exceeded')
 return raw

def main():
 os.umask(0o077);parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--inputs',required=True,type=Path);parser.add_argument('--cache',required=True,type=Path);parser.add_argument('--fixtures',type=Path);args=parser.parse_args();root=Path(__file__).resolve().parents[1];lock=json.loads((root/'inputs.lock.json').read_text());provenance=json.loads((root/'provenance.json').read_text())
 if digest((root/'provenance.json').read_bytes())!=lock['capturedProvenanceSha256']:raise ValueError('Provenance mismatch')
 args.inputs.mkdir(parents=True,exist_ok=True,mode=0o700);args.cache.mkdir(parents=True,exist_ok=True,mode=0o700);archives={};count=0
 def store(name,record,raw):
  if len(raw)!=record['bytes'] or digest(raw)!=record['sha256']:raise ValueError('Locked size/SHA256 mismatch: '+name)
  relative=PurePosixPath(name)
  if relative.is_absolute() or '..' in relative.parts:raise ValueError('Invalid input path')
  target=args.inputs/name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  if target.exists():
   if target.is_symlink() or target.read_bytes()!=raw:raise ValueError('Input destination collision: '+name)
  else:
   with target.open('xb') as output:output.write(raw)
 for item in lock['files']:
  target=args.inputs/item['path']
  if target.is_file() and not target.is_symlink() and target.stat().st_size==item['bytes'] and digest(target.read_bytes())==item['sha256']:count+=1;continue
  source=item['source'];url=source['url']
  if source['type']=='model-revision-file':raw=fetch(url,item['bytes'])
  elif source['type']=='npm-tar-member':
   if url not in archives:
    info=next(value for key,value in provenance.items() if isinstance(value,dict) and value.get('tarball')==url);expected=info['integrity'].split('-',1);assert expected[0]=='sha512'
    def matches(raw):return hashlib.sha1(raw).hexdigest()==info['shasum'] and base64.b64encode(hashlib.sha512(raw).digest()).decode()==expected[1]
    candidate=None
    for file in args.cache.glob('*.tgz'):
     if file.is_file() and not file.is_symlink() and matches(file.read_bytes()):candidate=file;break
    if candidate is None:
     rawArchive=fetch(url,info['unpackedSize']+16*1024*1024)
     if not matches(rawArchive):raise ValueError('Pinned npm package integrity mismatch')
     candidate=args.cache/(hashlib.sha256(url.encode()).hexdigest()+'.tgz')
     with candidate.open('xb') as output:output.write(rawArchive)
    archive=tarfile.open(candidate,'r:gz');members=[m for m in archive.getmembers() if m.isfile()]
    if len(members)!=info['fileCount'] or sum(m.size for m in members)!=info['unpackedSize']:raise ValueError('npm package catalog mismatch')
    archives[url]=archive
   member=archives[url].getmember(source['member'])
   if not member.isfile():raise ValueError('Locked member is not regular')
   raw=archives[url].extractfile(member).read()
  else:raise ValueError('Unsupported locked input type')
  store(item['path'],item,raw);count+=1
 if args.fixtures:
  fixture=json.loads((root/'tests/public-audio.lock.json').read_text());existing=args.fixtures/fixture['path'];raw=existing.read_bytes() if existing.is_file() and not existing.is_symlink() else fetch(fixture['url'],fixture['bytes'])
  if len(raw)!=fixture['bytes'] or digest(raw)!=fixture['sha256']:raise ValueError('Public fixture integrity mismatch')
  args.fixtures.mkdir(parents=True,exist_ok=True,mode=0o700);dest=args.fixtures/fixture['path']
  if dest.exists():
   if dest.is_symlink() or dest.read_bytes()!=raw:raise ValueError('Fixture destination collision')
  else:
   with dest.open('xb') as output:output.write(raw)
 for archive in archives.values():archive.close()
 print(json.dumps({'verifiedInputFiles':count,'fixtureFetched':bool(args.fixtures),'packageScriptsExecuted':0,'redirectQueryStringsLogged':False}))
if __name__=='__main__':main()
