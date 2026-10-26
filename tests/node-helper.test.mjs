import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('administrative adoption checks exact live data directory and rejects another user', () => {
  const script = String.raw`
import importlib.util, json, os, pathlib, tempfile
spec=importlib.util.spec_from_file_location('node_helper', __import__('sys').argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as root:
 p=pathlib.Path(root)/'123';p.mkdir()
 (p/'status').write_text('Uid:\t1000\t1000\t1000\t1000\n')
 (p/'cmdline').write_bytes(b'bitcoind\0-datadir=/tmp/data-other\0')
 assert not module.process_uses_datadir(123,1000,'/tmp/data',pathlib.Path(root))
 assert module.process_uses_datadir(123,1000,'/tmp/data-other',pathlib.Path(root))
 assert not module.process_uses_datadir(123,1001,'/tmp/data-other',pathlib.Path(root))
 (p/'cmdline').write_bytes(b'bitcoind\0-datadir\0/tmp/data with spaces\0')
 assert module.process_uses_datadir(123,1000,'/tmp/data with spaces',pathlib.Path(root))
name=__import__('pwd').getpwuid(os.getuid()).pw_name
text=module.unit(name, ['/tmp/$literal/bin', '-datadir=/tmp/$literal'], environment={'VALUE':'$literal'})
assert '$$literal' in text
assert 'Environment="VALUE=$literal"' in text
assert 'mariadb-server' not in module.dependency_packages('core')
assert 'cargo' not in module.dependency_packages('core')
assert 'mariadb-server' in module.dependency_packages('explorer')
assert 'libboost-dev' in module.dependency_packages('mutinynet')
try:
 module.dependency_packages('arbitrary-package')
 raise AssertionError('unreviewed package profile accepted')
except ValueError:
 pass
print('adoption identity verified')
`;
  const result = spawnSync('python3', ['-I', '-B', '-c', script, fileURLToPath(new URL('../src/node/node-helper.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /verified/);
});
