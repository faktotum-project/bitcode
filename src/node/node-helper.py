#!/usr/bin/python3
"""Root-owned helper. No shell, free-form commands, credential output or data deletion."""
import grp
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import tempfile

ROOT = Path('/etc/bitcode/nodes')
CORE_PACKAGES = ['ca-certificates', 'gnupg', 'tar']
EXPLORER_PACKAGES = ['git', 'build-essential', 'clang', 'libclang-dev', 'cmake', 'pkg-config', 'libssl-dev', 'cargo', 'mariadb-server', 'rsync']
MUTINYNET_PACKAGES = ['build-essential', 'cmake', 'libboost-dev', 'libevent-dev']


def dependency_packages(profile):
    profiles = {'core': CORE_PACKAGES, 'explorer': CORE_PACKAGES + EXPLORER_PACKAGES,
                'mutinynet': CORE_PACKAGES + MUTINYNET_PACKAGES,
                'mutinynet-explorer': CORE_PACKAGES + EXPLORER_PACKAGES + MUTINYNET_PACKAGES}
    if profile not in profiles:
        raise ValueError('Unknown dependency profile')
    return list(dict.fromkeys(profiles[profile]))



def call(args, input=None):
    result = subprocess.run(args, input=input, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'DEBIAN_FRONTEND': 'noninteractive'})
    if result.returncode:
        raise ValueError('System operation failed: ' + args[0])
    return result.stdout


def user_file(value, uid, directory=False, allow_root=False):
    if not isinstance(value, str) or not value.startswith('/') or any(c in value for c in '\n\r\x00%'):
        raise ValueError('Invalid path')
    flags = os.O_RDONLY | os.O_NOFOLLOW | (os.O_DIRECTORY if directory else 0)
    fd = os.open(value, flags)
    if os.fstat(fd).st_uid not in ([uid, 0] if allow_root else [uid]):
        os.close(fd)
        raise ValueError('Path must belong to the requesting user')
    return fd


def read_user_json(value, uid):
    with os.fdopen(user_file(value, uid)) as stream:
        return json.load(stream)


def quote(value):
    if not isinstance(value, str) or any(c in value for c in '\n\r\x00%'):
        raise ValueError('Invalid unit argument')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def atomic(file, text):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(text)
        os.chmod(temp, 0o600 if file.suffix == '.json' else 0o644)
        os.replace(temp, file)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def names(uid, instance_id, explorer):
    prefix = f'bitcode-{uid}-{instance_id}'
    return [prefix + '-core'] + ([prefix + '-electrs', prefix + '-mempool', prefix + '-web'] if explorer else [])


def unit(user, argv, after=None, environment=None, cwd=None):
    text = '[Unit]\nDescription=bitcode personal Bitcoin node\nAfter=network-online.target' + (' ' + after + '.service' if after else '') + '\n'
    if after:
        text += 'Requires=' + after + '.service\n'
    text += '[Service]\nType=simple\nUser=' + user + '\nGroup=' + grp.getgrgid(pwd.getpwnam(user).pw_gid).gr_name + '\n'
    text += 'ExecStart=' + ' '.join(quote(x.replace('$', '$$')) for x in argv) + '\n'
    if cwd:
        text += 'WorkingDirectory=' + quote(cwd) + '\n'
    for name, value in (environment or {}).items():
        text += 'Environment=' + quote(name + '=' + value) + '\n'
    return text + 'Restart=on-failure\nRestartSec=15\nTimeoutStopSec=900\nLimitNOFILE=65536\nNoNewPrivileges=true\nPrivateTmp=true\n[Install]\nWantedBy=multi-user.target\n'



def process_uses_datadir(pid, uid, datadir, proc_root=Path('/proc')):
    try:
        base = proc_root / str(pid)
        process_uid = int(re.search(r'^Uid:\s+(\d+)', (base / 'status').read_text(), re.M).group(1))
        if process_uid != uid:
            return False
        args = (base / 'cmdline').read_bytes().decode().strip('\0').split('\0')
        actual = None
        for pos, arg in enumerate(args):
            if arg.startswith('-datadir='):
                actual = arg[len('-datadir='):]
            elif arg == '-datadir' and pos + 1 < len(args):
                actual = args[pos + 1]
        if actual is None:
            if any(arg == '-conf' or arg.startswith('-conf=') for arg in args):
                return False
            actual = str(Path(pwd.getpwuid(uid).pw_dir) / '.bitcoin')
        return Path(actual).is_absolute() and Path(actual).resolve() == Path(datadir).resolve()
    except (OSError, ValueError, AttributeError, UnicodeError):
        return False


def main():
    if os.geteuid() != 0:
        raise ValueError('Administrative authentication required')
    helper = Path(__file__)
    st = helper.stat()
    if st.st_uid != 0 or st.st_mode & 0o022 or helper.is_symlink():
        raise ValueError('Install a root-owned helper first')
    uid = int(os.environ.get('PKEXEC_UID', os.environ.get('SUDO_UID', '-1')))
    if uid < 1000:
        raise ValueError('A non-root desktop user must request this operation')
    user = pwd.getpwuid(uid).pw_name
    request = json.loads(sys.stdin.read(131073))
    action = request.get('action')
    if action == 'dependencies':
        packages = dependency_packages(request.get('profile', 'core'))
        call(['/usr/bin/apt-get', 'update'])
        call(['/usr/bin/apt-get', 'install', '-y', '--no-install-recommends'] + packages)
        print(json.dumps({'ok': True, 'packages': packages}))
        return
    i = request.get('instance', {})
    instance_id = i.get('id', request.get('id', ''))
    if not re.fullmatch('[a-z][a-z0-9-]{0,39}', instance_id):
        raise ValueError('Invalid instance')
    registry = ROOT / f'{uid}-{instance_id}.json'
    if action == 'adopt':
        services = i.get('services', [])
        if not services or any(s not in ['bitcoind', 'electrs', 'mempool-backend'] for s in services):
            raise ValueError('Invalid existing services')
        if registry.exists() and json.loads(registry.read_text()) != {'services': services, 'adopted': True}:
            raise ValueError('Instance already registered with different services')
        for name in services:
            owner = call(['/usr/bin/systemctl', 'show', name, '--property=User', '--value']).strip()
            if owner not in [user, str(uid)]:
                raise ValueError('Service ownership does not match')
            if name == 'bitcoind':
                pid = int(call(['/usr/bin/systemctl', 'show', name, '--property=MainPID', '--value']).strip())
                if pid <= 0 or not process_uses_datadir(pid, uid, i['datadir']):
                    raise ValueError('Running Core process does not prove the requested data directory')
        atomic(registry, json.dumps({'services': services, 'adopted': True}))
    elif action == 'configure':
        if i.get('mode') != 'managed':
            raise ValueError('Only managed instances can be configured')
        os.close(user_file(i['binary'], uid))
        os.close(user_file(i['datadir'], uid, directory=True))
        services = names(uid, instance_id, i.get('explorer', False))
        old = json.loads(registry.read_text()) if registry.exists() else None
        if old and old.get('adopted'):
            raise ValueError('Adopted configuration requires manual review')
        units = {services[0]: unit(user, [i['binary'], '-datadir=' + i['datadir']])}
        if i.get('explorer'):
            p = i['explorerPaths']
            for key in ['electrs', 'electrsConf', 'backend', 'config']:
                os.close(user_file(p[key], uid))
            config = read_user_json(p['config'], uid)
            db = config['DATABASE']
            expected = f"bc_{uid}_{instance_id.replace('-', '_')}"
            if db['DATABASE'] != expected or db['USERNAME'] != expected or not re.fullmatch('[a-f0-9]{64}', db['PASSWORD']):
                raise ValueError('Invalid local database configuration')
            call(['/usr/bin/systemctl', 'enable', '--now', 'mariadb'])
            password = db['PASSWORD']
            call(['/usr/bin/mariadb', '--protocol=socket'], f"CREATE DATABASE IF NOT EXISTS `{expected}`; CREATE USER IF NOT EXISTS '{expected}'@'localhost' IDENTIFIED BY '{password}'; ALTER USER '{expected}'@'localhost' IDENTIFIED BY '{password}'; GRANT ALL PRIVILEGES ON `{expected}`.* TO '{expected}'@'localhost';")
            node = request['node']
            # Runtime may be supplied by a root-owned system package or by the user.
            runtime = Path(node)
            if not runtime.is_absolute() or not runtime.is_file() or any(c in node for c in '\n\r\x00%'):
                raise ValueError('Invalid Node runtime')
            os.close(user_file(request['webScript'], uid, allow_root=True))
            if p.get('kind') == 'mempool-electrs':
                if i.get('network') != 'mutinynet':
                    raise ValueError('Experimental indexer only applies to Mutinynet')
                args = read_user_json(p['electrsConf'], uid)['args']
                if not isinstance(args, list) or len(args) > 40 or any(not isinstance(a, str) for a in args):
                    raise ValueError('Invalid indexer arguments')
                units[services[1]] = unit(user, [p['electrs']] + args, services[0])
            else:
                units[services[1]] = unit(user, [p['electrs'], '--conf=' + p['electrsConf']], services[0])
            units[services[2]] = unit(user, [node, p['backend']], services[0], {'MEMPOOL_CONFIG_FILE': p['config'], 'NODE_ENV': 'production', 'ELECTRON_RUN_AS_NODE': '1'}, cwd=str(Path(p['backend']).parent.parent))
            web_config = str(Path(p['config']).parent / 'web.json')
            os.close(user_file(web_config, uid))
            units[services[3]] = unit(user, [node, request['webScript'], web_config], services[2], {'ELECTRON_RUN_AS_NODE': '1'})
        for name, text in units.items():
            target = Path('/etc/systemd/system') / (name + '.service')
            if target.exists() and not old and target.read_text() != text:
                raise ValueError('Refusing to overwrite an existing service')
            atomic(target, text)
        atomic(registry, json.dumps({'services': services, 'adopted': False}))
        call(['/usr/bin/systemctl', 'daemon-reload'])
        call(['/usr/bin/systemctl', 'enable', '--now'] + services)
    elif action in ['start', 'stop', 'restart', 'uninstall']:
        data = json.loads(registry.read_text())
        services = data['services']
        if action == 'uninstall':
            if data.get('adopted'):
                # Detach only: adopted units and data belong to their original setup.
                registry.unlink()
            else:
                call(['/usr/bin/systemctl', 'disable', '--now'] + list(reversed(services)))
                for name in services:
                    Path('/etc/systemd/system', name + '.service').unlink()
                registry.unlink()
                call(['/usr/bin/systemctl', 'daemon-reload'])
        else:
            call(['/usr/bin/systemctl', action] + (list(reversed(services)) if action == 'stop' else services))
    else:
        raise ValueError('Operation not allowed')
    print(json.dumps({'ok': True, 'action': action, 'dataPreserved': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # SQL and raw process stderr are intentionally excluded.
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else 'Administrative operation failed'}), file=sys.stderr)
        sys.exit(1)
